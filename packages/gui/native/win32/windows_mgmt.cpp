#include "windows_mgmt.h"
#include "json_output.h"
#include <windows.h>
#include <psapi.h>
#include <dwmapi.h>
#include <sstream>
#include <vector>
#include <string>
#include <algorithm>
#include <shellscalingapi.h>

#pragma comment(lib, "dwmapi.lib")

struct MonitorInfo {
    int index;
    RECT bounds;
    double scaleFactor;
};

struct WindowInfo {
    std::string title;
    std::string appName;
    DWORD pid;
    RECT bounds;
    HWND hwnd;
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

static std::string escape_json(const std::string& s) {
    std::string out;
    for (char c : s) {
        if (c == '"') out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else if (c == '\t') out += "\\t";
        else out += c;
    }
    return out;
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

static BOOL CALLBACK monitor_enum_proc(HMONITOR hMon, HDC, LPRECT, LPARAM lParam) {
    auto* monitors = reinterpret_cast<std::vector<MonitorInfo>*>(lParam);
    MONITORINFOEXW mi = {};
    mi.cbSize = sizeof(mi);
    if (!GetMonitorInfoW(hMon, &mi)) return TRUE;

    MonitorInfo info;
    info.index = (int)monitors->size() + 1;
    info.bounds = mi.rcMonitor;

    UINT dpiX = 96, dpiY = 96;
    if (SUCCEEDED(GetDpiForMonitor(hMon, MDT_EFFECTIVE_DPI, &dpiX, &dpiY))) {
        info.scaleFactor = dpiX / 96.0;
    } else {
        info.scaleFactor = 1.0;
    }

    monitors->push_back(info);
    return TRUE;
}

static BOOL CALLBACK window_enum_proc(HWND hwnd, LPARAM lParam) {
    auto* windows = reinterpret_cast<std::vector<WindowInfo>*>(lParam);
    if (!IsWindowVisible(hwnd)) return TRUE;

    wchar_t title[512] = {};
    int len = GetWindowTextW(hwnd, title, 512);
    if (len == 0) return TRUE;

    LONG exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
    if (exStyle & WS_EX_TOOLWINDOW) return TRUE;

    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);

    RECT rect = {};
    DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &rect, sizeof(rect));

    WindowInfo info;
    info.title = wchar_to_utf8(title, len);
    info.appName = get_process_name(pid);
    info.pid = pid;
    info.bounds = rect;
    info.hwnd = hwnd;

    windows->push_back(info);
    return TRUE;
}

static std::string rect_to_json(const RECT& r) {
    std::ostringstream ss;
    ss << R"({"x":)" << r.left << R"(,"y":)" << r.top
       << R"(,"width":)" << (r.right - r.left)
       << R"(,"height":)" << (r.bottom - r.top) << "}";
    return ss.str();
}

static std::string window_to_json(const WindowInfo& w) {
    std::ostringstream ss;
    ss << R"({"title":")" << escape_json(w.title)
       << R"(","appName":")" << escape_json(w.appName)
       << R"(","pid":)" << w.pid
       << R"(,"bounds":)" << rect_to_json(w.bounds) << "}";
    return ss.str();
}

struct FilterFlags {
    std::string app;
    std::string title;
};

static FilterFlags parse_filter_flags(int argc, char* argv[]) {
    FilterFlags f;
    for (int i = 0; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "--app" && i + 1 < argc) f.app = argv[++i];
        else if (arg == "--title" && i + 1 < argc) f.title = argv[++i];
    }
    return f;
}

static std::string to_lower(const std::string& s) {
    std::string r = s;
    std::transform(r.begin(), r.end(), r.begin(), ::tolower);
    return r;
}

static bool matches_filter(const WindowInfo& w, const FilterFlags& f) {
    if (!f.app.empty()) {
        if (to_lower(w.appName).find(to_lower(f.app)) == std::string::npos)
            return false;
    }
    if (!f.title.empty()) {
        if (to_lower(w.title).find(to_lower(f.title)) == std::string::npos)
            return false;
    }
    return true;
}

int cmd_capture_context(int argc, char* argv[]) {
    FilterFlags flags = parse_filter_flags(argc, argv);

    std::vector<MonitorInfo> monitors;
    EnumDisplayMonitors(nullptr, nullptr, monitor_enum_proc, (LPARAM)&monitors);
    if (monitors.empty()) {
        understudy::write_error("DISPLAY_NOT_FOUND", "No display monitors found");
        return 1;
    }

    POINT cursor = {};
    GetCursorPos(&cursor);

    std::vector<WindowInfo> windows;
    EnumWindows(window_enum_proc, (LPARAM)&windows);

    HWND fg = GetForegroundWindow();
    std::string frontmostApp;
    std::string frontmostTitle;
    for (const auto& w : windows) {
        if (w.hwnd == fg) {
            frontmostApp = w.appName;
            frontmostTitle = w.title;
            break;
        }
    }

    if (!flags.app.empty()) {
        for (const auto& w : windows) {
            if (to_lower(w.appName).find(to_lower(flags.app)) != std::string::npos) {
                frontmostApp = w.appName;
                frontmostTitle = w.title;
                break;
            }
        }
    }

    std::ostringstream data;
    data << R"({"displays":[)";
    for (size_t i = 0; i < monitors.size(); i++) {
        if (i > 0) data << ",";
        data << R"({"index":)" << monitors[i].index
             << R"(,"bounds":)" << rect_to_json(monitors[i].bounds)
             << R"(,"scaleFactor":)" << monitors[i].scaleFactor << "}";
    }
    data << R"(],"cursor":{"x":)" << cursor.x << R"(,"y":)" << cursor.y << "}";

    data << R"(,"windows":[)";
    bool first = true;
    for (const auto& w : windows) {
        if (!first) data << ",";
        data << window_to_json(w);
        first = false;
    }
    data << "]";

    data << R"(,"frontmostApp":")" << escape_json(frontmostApp) << R"(")";
    data << R"(,"frontmostWindowTitle":")" << escape_json(frontmostTitle) << R"(")";
    data << "}";

    understudy::write_ok(data.str());
    return 0;
}

int cmd_enumerate_windows(int argc, char* argv[]) {
    FilterFlags flags = parse_filter_flags(argc, argv);

    std::vector<WindowInfo> windows;
    EnumWindows(window_enum_proc, (LPARAM)&windows);

    std::ostringstream data;
    data << "[";
    bool first = true;
    for (const auto& w : windows) {
        if (!matches_filter(w, flags)) continue;
        if (!first) data << ",";
        data << window_to_json(w);
        first = false;
    }
    data << "]";

    understudy::write_ok(data.str());
    return 0;
}

int cmd_activate_window(int argc, char* argv[]) {
    FilterFlags flags = parse_filter_flags(argc, argv);

    std::vector<WindowInfo> windows;
    EnumWindows(window_enum_proc, (LPARAM)&windows);

    for (const auto& w : windows) {
        if (!matches_filter(w, flags)) continue;
        SetForegroundWindow(w.hwnd);
        understudy::write_ok(R"({"activated":")" + escape_json(w.title) + R"("})");
        return 0;
    }

    understudy::write_error("WINDOW_NOT_FOUND", "No window matching filter criteria");
    return 1;
}
