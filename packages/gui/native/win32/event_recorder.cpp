#include "event_recorder.h"
#include "json_output.h"
#include <windows.h>
#include <psapi.h>
#include <uiautomation.h>
#include <string>
#include <vector>
#include <sstream>
#include <fstream>
#include <chrono>
#include <cstdlib>
#include <mutex>

#pragma comment(lib, "oleaut32.lib")

// Custom message for async UIA element-name lookups.
// Posted from the LL hook callback (which must return quickly) and handled
// in the main message loop (where COM calls are safe and unhurried).
#define WM_UIA_LOOKUP (WM_APP + 1)

struct UiaLookupRequest {
    POINT pt;
    size_t eventIndex;
};

static std::string wchar_to_utf8(const wchar_t* wstr, int len = -1) {
    if (!wstr || (len == 0)) return "";
    if (len < 0) len = (int)wcslen(wstr);
    int size = WideCharToMultiByte(CP_UTF8, 0, wstr, len, nullptr, 0, nullptr, nullptr);
    if (size <= 0) return "";
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, wstr, len, result.data(), size, nullptr, nullptr);
    return result;
}

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

struct RecordedEvent {
    std::string type;
    int64_t timestampMs;
    std::string source = "input";
    std::string app;
    std::string windowTitle;
    std::string target;
    std::string button;
    double x = 0, y = 0;
    int keyCode = -1;
    std::vector<std::string> modifiers;
    std::string importance = "medium";
};

static std::vector<RecordedEvent> g_events;
static std::mutex g_mutex;
static std::string g_output_path;
static HHOOK g_mouseHook = nullptr;
static HHOOK g_keyboardHook = nullptr;
static IUIAutomation* g_uia = nullptr;
static DWORD g_thread_id = 0;

static int64_t now_ms() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

static std::string get_foreground_info(std::string& app, std::string& title) {
    HWND fg = GetForegroundWindow();
    if (!fg) return "";
    wchar_t buf[512] = {};
    GetWindowTextW(fg, buf, 512);
    title = wchar_to_utf8(buf);
    DWORD pid = 0;
    GetWindowThreadProcessId(fg, &pid);
    app = get_process_name(pid);
    return title;
}

// Resolve a UIA element name at the given point.
// Must only be called from the main message-loop thread (COM/STA).
static std::string get_uia_element_name(POINT pt) {
    if (!g_uia) return "";
    IUIAutomationElement* elem = nullptr;
    HRESULT hr = g_uia->ElementFromPoint(pt, &elem);
    if (FAILED(hr) || !elem) return "";
    BSTR name = nullptr;
    elem->get_CurrentName(&name);
    std::string result;
    if (name) {
        result = wchar_to_utf8(name);
        SysFreeString(name);
    }
    if (result.empty()) {
        BSTR autoId = nullptr;
        elem->get_CurrentAutomationId(&autoId);
        if (autoId) {
            result = wchar_to_utf8(autoId);
            SysFreeString(autoId);
        }
    }
    elem->Release();
    return result;
}

static std::vector<std::string> get_active_modifiers() {
    std::vector<std::string> mods;
    if (GetAsyncKeyState(VK_CONTROL) & 0x8000) mods.push_back("ctrl");
    if (GetAsyncKeyState(VK_MENU) & 0x8000) mods.push_back("alt");
    if (GetAsyncKeyState(VK_SHIFT) & 0x8000) mods.push_back("shift");
    if (GetAsyncKeyState(VK_LWIN) & 0x8000 || GetAsyncKeyState(VK_RWIN) & 0x8000) mods.push_back("win");
    return mods;
}

static LRESULT CALLBACK mouse_proc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0) {
        auto* ms = (MSLLHOOKSTRUCT*)lParam;
        RecordedEvent evt;
        evt.timestampMs = now_ms();
        evt.x = ms->pt.x;
        evt.y = ms->pt.y;
        evt.modifiers = get_active_modifiers();

        std::string app, title;
        get_foreground_info(app, title);
        evt.app = app;
        evt.windowTitle = title;
        // UIA lookup is deferred via WM_UIA_LOOKUP to avoid blocking this callback.

        bool record = true;
        switch (wParam) {
            case WM_LBUTTONDOWN: evt.type = "mouse_down"; evt.button = "left";  evt.importance = "high";   break;
            case WM_LBUTTONUP:   evt.type = "mouse_up";   evt.button = "left";  evt.importance = "low";    break;
            case WM_RBUTTONDOWN: evt.type = "mouse_down"; evt.button = "right"; evt.importance = "high";   break;
            case WM_RBUTTONUP:   evt.type = "mouse_up";   evt.button = "right"; evt.importance = "low";    break;
            case WM_MOUSEWHEEL:  evt.type = "scroll";                           evt.importance = "medium"; break;
            default: record = false; break;
        }

        if (record) {
            size_t eventIdx;
            {
                std::lock_guard<std::mutex> lock(g_mutex);
                eventIdx = g_events.size();
                g_events.push_back(std::move(evt));
            }
            // Request async UIA lookup in the main message loop
            if (g_thread_id && g_uia) {
                auto* req = new UiaLookupRequest{ ms->pt, eventIdx };
                PostThreadMessageW(g_thread_id, WM_UIA_LOOKUP, 0, reinterpret_cast<LPARAM>(req));
            }
        }
    }
    return CallNextHookEx(g_mouseHook, nCode, wParam, lParam);
}

static LRESULT CALLBACK keyboard_proc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && (wParam == WM_KEYDOWN || wParam == WM_KEYUP)) {
        auto* kb = (KBDLLHOOKSTRUCT*)lParam;
        RecordedEvent evt;
        evt.timestampMs = now_ms();
        evt.type = (wParam == WM_KEYDOWN) ? "key_down" : "key_up";
        evt.keyCode = kb->vkCode;
        evt.modifiers = get_active_modifiers();
        evt.importance = (wParam == WM_KEYDOWN) ? "medium" : "low";

        std::string app, title;
        get_foreground_info(app, title);
        evt.app = app;
        evt.windowTitle = title;

        std::lock_guard<std::mutex> lock(g_mutex);
        g_events.push_back(std::move(evt));
    }
    return CallNextHookEx(g_keyboardHook, nCode, wParam, lParam);
}

static std::string event_to_json(const RecordedEvent& e) {
    std::ostringstream ss;
    ss << R"({"type":")" << understudy::escape_json(e.type)
       << R"(","timestampMs":)" << e.timestampMs
       << R"(,"source":")" << understudy::escape_json(e.source) << "\"";
    if (!e.button.empty()) ss << R"(,"button":")" << understudy::escape_json(e.button) << "\"";
    if (!e.app.empty()) ss << R"(,"app":")" << understudy::escape_json(e.app) << "\"";
    if (!e.windowTitle.empty()) ss << R"(,"windowTitle":")" << understudy::escape_json(e.windowTitle) << "\"";
    if (!e.target.empty()) ss << R"(,"target":")" << understudy::escape_json(e.target) << "\"";
    if (e.type.find("mouse") != std::string::npos || e.type == "scroll")
        ss << R"(,"x":)" << e.x << R"(,"y":)" << e.y;
    if (e.keyCode >= 0)
        ss << R"(,"keyCode":)" << e.keyCode;
    if (!e.modifiers.empty()) {
        ss << R"(,"modifiers":[)";
        for (size_t i = 0; i < e.modifiers.size(); i++) {
            if (i > 0) ss << ",";
            ss << "\"" << understudy::escape_json(e.modifiers[i]) << "\"";
        }
        ss << "]";
    }
    ss << R"(,"importance":")" << understudy::escape_json(e.importance) << "\"}";
    return ss.str();
}

static void persist_events() {
    std::lock_guard<std::mutex> lock(g_mutex);
    std::ofstream out(g_output_path);
    out << "[\n";
    for (size_t i = 0; i < g_events.size(); i++) {
        if (i > 0) out << ",\n";
        out << "  " << event_to_json(g_events[i]);
    }
    out << "\n]" << std::endl;
    understudy::log("Persisted " + std::to_string(g_events.size()) + " events to " + g_output_path);
}

// Timer callback — fires once after --stop-after-ms elapses.
// Posts WM_QUIT so GetMessage() returns 0 and the normal cleanup path runs.
static void CALLBACK stop_timer_proc(HWND, UINT, UINT_PTR, DWORD) {
    PostQuitMessage(0);
}

static BOOL WINAPI console_handler(DWORD signal) {
    if (signal == CTRL_C_EVENT || signal == CTRL_BREAK_EVENT || signal == CTRL_CLOSE_EVENT) {
        persist_events();
        if (g_mouseHook) UnhookWindowsHookEx(g_mouseHook);
        if (g_keyboardHook) UnhookWindowsHookEx(g_keyboardHook);
        if (g_uia) g_uia->Release();
        ExitProcess(0);
    }
    return TRUE;
}

int cmd_record_events(int argc, char* argv[]) {
    if (argc < 1) {
        understudy::write_error("INTERNAL_ERROR", "record-events requires <outputPath>");
        return 1;
    }
    g_output_path = argv[0];
    g_thread_id = GetCurrentThreadId();

    int stop_after_ms = 0;
    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "--stop-after-ms") {
            if (i + 1 >= argc) {
                understudy::write_error("INVALID_ARGUMENT", "--stop-after-ms requires a value");
                return 1;
            }
            char* end = nullptr;
            long val = std::strtol(argv[++i], &end, 10);
            if (end == argv[i] || *end != '\0' || val <= 0 || val > UINT_MAX) {
                understudy::write_error("INVALID_ARGUMENT", "--stop-after-ms requires a positive integer");
                return 1;
            }
            stop_after_ms = static_cast<int>(val);
            break;
        }
    }

    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER,
                     __uuidof(IUIAutomation), (void**)&g_uia);

    SetConsoleCtrlHandler(console_handler, TRUE);

    g_mouseHook = SetWindowsHookExW(WH_MOUSE_LL, mouse_proc, nullptr, 0);
    g_keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboard_proc, nullptr, 0);

    if (!g_mouseHook || !g_keyboardHook) {
        understudy::write_error("HOOK_INSTALL_FAILED", "SetWindowsHookEx returned NULL");
        return 1;
    }

    understudy::log("Recording events to " + g_output_path + " — press Ctrl+C to stop");

    if (stop_after_ms > 0) {
        UINT_PTR timerId = SetTimer(nullptr, 0, static_cast<UINT>(stop_after_ms), stop_timer_proc);
        if (!timerId) {
            understudy::write_error("TIMER_FAILED", "SetTimer returned 0");
            return 1;
        }
        understudy::log("Will stop after " + std::to_string(stop_after_ms) + " ms");
    }

    MSG msg;
    while (GetMessage(&msg, nullptr, 0, 0)) {
        if (msg.message == WM_UIA_LOOKUP) {
            // Async UIA element-name resolution — safe to block here
            auto* req = reinterpret_cast<UiaLookupRequest*>(msg.lParam);
            if (req) {
                std::string target = get_uia_element_name(req->pt);
                if (!target.empty()) {
                    std::lock_guard<std::mutex> lock(g_mutex);
                    if (req->eventIndex < g_events.size()) {
                        g_events[req->eventIndex].target = target;
                    }
                }
                delete req;
            }
        } else {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }

    persist_events();
    UnhookWindowsHookEx(g_mouseHook);
    UnhookWindowsHookEx(g_keyboardHook);
    if (g_uia) g_uia->Release();
    CoUninitialize();
    return 0;
}
