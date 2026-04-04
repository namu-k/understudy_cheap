#include "uia_tree.h"
#include "json_output.h"
#include <windows.h>
#include <uiautomation.h>
#include <psapi.h>
#include <string>
#include <sstream>
#include <vector>
#include <map>
#include <algorithm>

#pragma comment(lib, "oleaut32.lib")

// ---------------------------------------------------------------------------
// ArgMap — same pattern as input.cpp
// ---------------------------------------------------------------------------
struct ArgMap {
    std::vector<std::string> positional;
    std::map<std::string, std::string> flags;

    static bool is_boolean_flag(const std::string& name) {
        return name == "include-invisible";
    }

    static ArgMap parse(int argc, char* argv[]) {
        ArgMap m;
        bool positional_only = false;
        for (int i = 0; i < argc; i++) {
            std::string arg = argv[i];
            if (positional_only) {
                m.positional.push_back(arg);
            } else if (arg == "--") {
                positional_only = true;
            } else if (arg.size() > 2 && arg.substr(0, 2) == "--") {
                std::string name = arg.substr(2);
                if (is_boolean_flag(name)) {
                    m.flags[name] = "1";
                } else if (i + 1 < argc) {
                    m.flags[name] = argv[++i];
                } else {
                    m.flags[name] = "1";
                }
            } else {
                m.positional.push_back(arg);
            }
        }
        return m;
    }

    std::string flag(const std::string& name, const std::string& def = "") const {
        auto it = flags.find(name);
        return it != flags.end() ? it->second : def;
    }
    int flag_int(const std::string& name, int def = 0) const {
        auto it = flags.find(name);
        if (it == flags.end()) return def;
        try { return std::stoi(it->second); } catch (...) { return def; }
    }
};

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------
static std::string wchar_to_utf8(const wchar_t* wstr, int len = -1) {
    if (!wstr || (len == 0)) return "";
    if (len < 0) len = (int)wcslen(wstr);
    int size = WideCharToMultiByte(CP_UTF8, 0, wstr, len, nullptr, 0, nullptr, nullptr);
    if (size <= 0) return "";
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, wstr, len, result.data(), size, nullptr, nullptr);
    return result;
}

static std::string utf8_to_lower(const std::string& s) {
    std::string r = s;
    std::transform(r.begin(), r.end(), r.begin(), ::tolower);
    return r;
}

static std::string bstr_to_utf8(BSTR bstr) {
    if (!bstr) return "";
    return wchar_to_utf8(bstr, (int)SysStringLen(bstr));
}

// ---------------------------------------------------------------------------
// UIA control-type mapping
// ---------------------------------------------------------------------------
static std::string control_type_name(CONTROLTYPEID id) {
    static const std::map<CONTROLTYPEID, const char*> names = {
        { UIA_ButtonControlTypeId,            "Button" },
        { UIA_CalendarControlTypeId,          "Calendar" },
        { UIA_CheckBoxControlTypeId,          "CheckBox" },
        { UIA_ComboBoxControlTypeId,          "ComboBox" },
        { UIA_EditControlTypeId,              "Edit" },
        { UIA_HyperlinkControlTypeId,         "Hyperlink" },
        { UIA_ImageControlTypeId,             "Image" },
        { UIA_ListItemControlTypeId,          "ListItem" },
        { UIA_ListControlTypeId,              "List" },
        { UIA_MenuControlTypeId,              "Menu" },
        { UIA_MenuBarControlTypeId,           "MenuBar" },
        { UIA_MenuItemControlTypeId,          "MenuItem" },
        { UIA_ProgressBarControlTypeId,       "ProgressBar" },
        { UIA_RadioButtonControlTypeId,       "RadioButton" },
        { UIA_ScrollBarControlTypeId,         "ScrollBar" },
        { UIA_SliderControlTypeId,            "Slider" },
        { UIA_SpinnerControlTypeId,           "Spinner" },
        { UIA_StatusBarControlTypeId,         "StatusBar" },
        { UIA_TabControlTypeId,               "Tab" },
        { UIA_TabItemControlTypeId,           "TabItem" },
        { UIA_TextControlTypeId,              "Text" },
        { UIA_ToolBarControlTypeId,           "ToolBar" },
        { UIA_ToolTipControlTypeId,           "ToolTip" },
        { UIA_TreeControlTypeId,              "Tree" },
        { UIA_TreeItemControlTypeId,          "TreeItem" },
        { UIA_CustomControlTypeId,            "Custom" },
        { UIA_GroupControlTypeId,             "Group" },
        { UIA_ThumbControlTypeId,             "Thumb" },
        { UIA_DataGridControlTypeId,          "DataGrid" },
        { UIA_DataItemControlTypeId,          "DataItem" },
        { UIA_DocumentControlTypeId,          "Document" },
        { UIA_SplitButtonControlTypeId,       "SplitButton" },
        { UIA_WindowControlTypeId,            "Window" },
        { UIA_PaneControlTypeId,              "Pane" },
        { UIA_HeaderControlTypeId,            "Header" },
        { UIA_HeaderItemControlTypeId,        "HeaderItem" },
        { UIA_TableControlTypeId,             "Table" },
        { UIA_TitleBarControlTypeId,          "TitleBar" },
        { UIA_SeparatorControlTypeId,         "Separator" },
        { UIA_SemanticZoomControlTypeId,      "SemanticZoom" },
        { UIA_AppBarControlTypeId,            "AppBar" },
    };
    auto it = names.find(id);
    if (it != names.end()) return it->second;
    return "Unknown(" + std::to_string(id) + ")";
}

// ---------------------------------------------------------------------------
// Window lookup helpers
// ---------------------------------------------------------------------------
struct WindowMatch {
    HWND hwnd;
    std::string title;
    std::string appName;
};

static std::string get_process_name(DWORD pid) {
    HANDLE proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!proc) return "";
    wchar_t path[MAX_PATH] = {};
    DWORD size = MAX_PATH;
    std::string name;
    if (QueryFullProcessImageNameW(proc, 0, path, &size)) {
        std::wstring ws(path);
        auto pos = ws.find_last_of(L"\\/");
        if (pos != std::wstring::npos)
            name = wchar_to_utf8(ws.c_str() + pos + 1);
        else
            name = wchar_to_utf8(ws.c_str());
        if (name.size() > 4 && name.substr(name.size() - 4) == ".exe")
            name = name.substr(0, name.size() - 4);
    }
    CloseHandle(proc);
    return name;
}

struct FindWindowCtx {
    std::string app;
    std::string title;
    WindowMatch result;
    bool found;
};

static BOOL CALLBACK find_window_proc(HWND hwnd, LPARAM lParam) {
    auto* ctx = reinterpret_cast<FindWindowCtx*>(lParam);
    if (!IsWindowVisible(hwnd)) return TRUE;

    // Fix 4: WS_EX_TOOLWINDOW + empty-title filter (matches windows_mgmt.cpp:92-101)
    wchar_t title_buf[512] = {};
    int title_len = GetWindowTextW(hwnd, title_buf, 512);
    if (title_len == 0) return TRUE;
    LONG exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
    if (exStyle & WS_EX_TOOLWINDOW) return TRUE;

    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    std::string appName = get_process_name(pid);
    std::string winTitle = wchar_to_utf8(title_buf, title_len);

    if (!ctx->app.empty()) {
        if (utf8_to_lower(appName).find(utf8_to_lower(ctx->app)) == std::string::npos)
            return TRUE;
    }
    if (!ctx->title.empty()) {
        if (utf8_to_lower(winTitle).find(utf8_to_lower(ctx->title)) == std::string::npos)
            return TRUE;
    }

    ctx->result.hwnd = hwnd;
    ctx->result.title = winTitle;
    ctx->result.appName = appName;
    ctx->found = true;
    return FALSE; // stop enumeration
}

// ---------------------------------------------------------------------------
// UIA tree serialization
// ---------------------------------------------------------------------------
struct SerializeState {
    IUIAutomation* automation;
    int maxDepth;
    int count;
    int maxCount;
    bool includeInvisible;
};

static std::string serialize_element(IUIAutomationElement* elem, int depth, SerializeState& state);

static std::string serialize_children(IUIAutomationElement* parent, int depth, SerializeState& state) {
    if (depth >= state.maxDepth) return "[]";

    IUIAutomationCondition* trueCond = nullptr;
    HRESULT hr = state.automation->CreateTrueCondition(&trueCond);
    if (FAILED(hr) || !trueCond) return "[]";

    IUIAutomationElementArray* children = nullptr;
    hr = parent->FindAll(TreeScope_Children, trueCond, &children);
    trueCond->Release();

    if (FAILED(hr) || !children) return "[]";

    int childCount = 0;
    children->get_Length(&childCount);

    std::ostringstream ss;
    ss << "[";
    for (int i = 0; i < childCount; i++) {
        IUIAutomationElement* child = nullptr;
        if (SUCCEEDED(children->GetElement(i, &child)) && child) {
            if (state.count >= state.maxCount) {
                child->Release();
                break;
            }
            if (i > 0) ss << ",";
            ss << serialize_element(child, depth + 1, state);
            child->Release();
        }
    }
    ss << "]";
    children->Release();
    return ss.str();
}

static std::string serialize_element(IUIAutomationElement* elem, int depth, SerializeState& state) {
    state.count++;

    // Basic properties
    BSTR nameBstr = nullptr;
    elem->get_CurrentName(&nameBstr);
    std::string name = bstr_to_utf8(nameBstr);
    SysFreeString(nameBstr);

    CONTROLTYPEID typeId = 0;
    elem->get_CurrentControlType(&typeId);
    std::string typeName = control_type_name(typeId);

    BSTR classBstr = nullptr;
    elem->get_CurrentClassName(&classBstr);
    std::string className = bstr_to_utf8(classBstr);
    SysFreeString(classBstr);

    BSTR aidBstr = nullptr;
    elem->get_CurrentAutomationId(&aidBstr);
    std::string automationId = bstr_to_utf8(aidBstr);
    SysFreeString(aidBstr);

    BOOL isEnabled = TRUE;
    elem->get_CurrentIsEnabled(&isEnabled);

    RECT rect = {};
    elem->get_CurrentBoundingRectangle(&rect);

    std::ostringstream ss;
    ss << "{";
    ss << R"("name":")" << understudy::escape_json(name) << R"(")";
    ss << R"(,"type":")" << understudy::escape_json(typeName) << R"(")";
    if (!className.empty())
        ss << R"(,"className":")" << understudy::escape_json(className) << R"(")";
    if (!automationId.empty())
        ss << R"(,"automationId":")" << understudy::escape_json(automationId) << R"(")";
    ss << R"(,"enabled":)" << (isEnabled ? "true" : "false");
    ss << R"(,"bounds":{"x":)" << rect.left
       << R"(,"y":)" << rect.top
       << R"(,"width":)" << (rect.right - rect.left)
       << R"(,"height":)" << (rect.bottom - rect.top) << "}";

    // Recurse children
    std::string childrenJson = serialize_children(elem, depth, state);
    ss << R"(,"children":)" << childrenJson;

    ss << "}";
    return ss.str();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
int cmd_uia_tree(int argc, char* argv[]) {
    ArgMap args = ArgMap::parse(argc, argv);

    // Fix 3: Default max-depth lowered from 25 to 8
    int maxDepth = args.flag_int("max-depth", 8);
    int maxCount = args.flag_int("max-count", 2000);
    std::string hwndStr = args.flag("hwnd");
    std::string appFilter = args.flag("app");
    std::string titleFilter = args.flag("title");

    // --- COM initialization ---
    // Fix 2: Track whether this call actually initialized COM
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    bool com_initialized = SUCCEEDED(hr) && hr != RPC_E_CHANGED_MODE;
    if (FAILED(hr) && hr != RPC_E_CHANGED_MODE && hr != S_FALSE) {
        understudy::write_error("COM_ERROR", "CoInitializeEx failed: " + std::to_string(hr));
        return 1;
    }

    // --- Create IUIAutomation ---
    IUIAutomation* automation = nullptr;
    hr = CoCreateInstance(CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER,
                          IID_IUIAutomation, (void**)&automation);
    if (FAILED(hr) || !automation) {
        understudy::write_error("UIA_ERROR", "Failed to create IUIAutomation: " + std::to_string(hr));
        if (com_initialized) CoUninitialize();
        return 1;
    }

    // --- Resolve target element ---
    IUIAutomationElement* target = nullptr;

    // Path A: --hwnd specified
    if (!hwndStr.empty()) {
        // Fix 1: Wrap stoull in try/catch for invalid hwnd
        HWND hwnd = nullptr;
        try {
            unsigned long long val = std::stoull(hwndStr);
            hwnd = reinterpret_cast<HWND>(static_cast<uintptr_t>(val));
        } catch (...) {
            understudy::write_error("INVALID_HWND", "Invalid --hwnd value: " + hwndStr);
            automation->Release();
            if (com_initialized) CoUninitialize();
            return 1;
        }
        hr = automation->ElementFromHandle(hwnd, &target);
        if (FAILED(hr) || !target) {
            understudy::write_error("UIA_ERROR", "ElementFromHandle failed for hwnd " + hwndStr);
            automation->Release();
            if (com_initialized) CoUninitialize();
            return 1;
        }
    }
    // Path B: --app and/or --title
    else if (!appFilter.empty() || !titleFilter.empty()) {
        FindWindowCtx ctx = { appFilter, titleFilter, {}, false };
        EnumWindows(find_window_proc, reinterpret_cast<LPARAM>(&ctx));
        if (!ctx.found) {
            understudy::write_error("WINDOW_NOT_FOUND", "No window matching app/title filter");
            automation->Release();
            if (com_initialized) CoUninitialize();
            return 1;
        }
        hr = automation->ElementFromHandle(ctx.result.hwnd, &target);
        if (FAILED(hr) || !target) {
            understudy::write_error("UIA_ERROR", "ElementFromHandle failed for window");
            automation->Release();
            if (com_initialized) CoUninitialize();
            return 1;
        }
    }
    // Path C: Desktop root
    else {
        hr = automation->GetRootElement(&target);
        if (FAILED(hr) || !target) {
            understudy::write_error("UIA_ERROR", "GetRootElement failed");
            automation->Release();
            if (com_initialized) CoUninitialize();
            return 1;
        }
    }

    // --- Serialize tree ---
    SerializeState state;
    state.automation = automation;
    state.maxDepth = maxDepth;
    state.count = 0;
    state.maxCount = maxCount;
    state.includeInvisible = args.flags.count("include-invisible") > 0;

    std::string treeJson = serialize_element(target, 0, state);

    std::ostringstream out;
    out << R"({"depth":)" << maxDepth
        << R"(,"count":)" << state.count
        << R"(,"tree":)" << treeJson
        << "}";

    target->Release();
    automation->Release();
    if (com_initialized) CoUninitialize();

    understudy::write_ok(out.str());
    return 0;
}
