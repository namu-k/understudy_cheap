#include "readiness.h"
#include "json_output.h"
#include <windows.h>
#include <roapi.h>
#include <winstring.h>
#include <winrt/base.h>
#include <uiautomation.h>
#include <sstream>

#pragma comment(lib, "runtimeobject.lib")

static std::string check_wgc() {
    HRESULT hr = RoInitialize(RO_INIT_MULTITHREADED);
    if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
        return R"({"status":false,"detail":"RoInitialize failed"})";
    }
    HSTRING className;
    HSTRING_HEADER hdr;
    const wchar_t name[] = L"Windows.Graphics.Capture.GraphicsCaptureSession";
    hr = WindowsCreateStringReference(name, (UINT32)wcslen(name), &hdr, &className);
    if (FAILED(hr)) {
        return R"({"status":false,"detail":"Cannot create WinRT string"})";
    }
    IInspectable* factory = nullptr;
    hr = RoGetActivationFactory(className, IID_IInspectable, (void**)&factory);
    if (factory) factory->Release();

    OSVERSIONINFOEXW osvi = {};
    osvi.dwOSVersionInfoSize = sizeof(osvi);
    using RtlGetVersionFn = LONG(WINAPI*)(OSVERSIONINFOEXW*);
    auto RtlGetVersion = (RtlGetVersionFn)GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "RtlGetVersion");
    DWORD build = 0;
    if (RtlGetVersion && RtlGetVersion(&osvi) == 0) {
        build = osvi.dwBuildNumber;
    }

    bool available = SUCCEEDED(hr);
    std::ostringstream detail;
    detail << "Windows.Graphics.Capture API "
           << (available ? "available" : "unavailable")
           << " (build " << build << (available ? " >= 19041" : " < 19041") << ")";

    return std::string(R"({"status":)") + (available ? "true" : "false")
        + R"(,"detail":")" + detail.str() + R"("})";
}

static std::string check_sendinput() {
    SetLastError(0);
    UINT result = SendInput(0, nullptr, sizeof(INPUT));
    bool ok = (GetLastError() == 0 || GetLastError() == ERROR_SUCCESS);
    return std::string(R"({"status":)") + (ok ? "true" : "false")
        + R"(,"detail":"SendInput API callable"})";
}

static std::string check_uia() {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    bool coinit_ok = SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE;
    if (!coinit_ok) {
        return R"({"status":false,"detail":"CoInitializeEx failed"})";
    }
    IUIAutomation* uia = nullptr;
    hr = CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER,
                          __uuidof(IUIAutomation), (void**)&uia);
    if (uia) uia->Release();
    bool ok = SUCCEEDED(hr);
    return std::string(R"({"status":)") + (ok ? "true" : "false")
        + R"(,"detail":"IUIAutomation COM object )" + (ok ? "created successfully" : "creation failed") + R"("})";
}

static std::string check_dpi() {
    DPI_AWARENESS_CONTEXT ctx = GetThreadDpiAwarenessContext();
    std::string level;
    if (AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2))
        level = "per_monitor_v2";
    else if (AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE))
        level = "per_monitor";
    else if (AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_SYSTEM_AWARE))
        level = "system";
    else
        level = "unaware";
    return R"({"status":")" + level + R"(","detail":"DPI awareness context: )" + level + R"("})";
}

static std::string check_elevation() {
    HANDLE token = nullptr;
    bool elevated = false;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) {
        TOKEN_ELEVATION elev = {};
        DWORD size = 0;
        if (GetTokenInformation(token, TokenElevation, &elev, sizeof(elev), &size)) {
            elevated = (elev.TokenIsElevated != 0);
        }
        CloseHandle(token);
    }
    std::string detail = elevated
        ? "Running as Administrator"
        : "Not running as Administrator. UAC prompts may block SendInput.";
    return std::string(R"({"status":)") + (elevated ? "true" : "false")
        + R"(,"detail":")" + detail + R"("})";
}

static std::string get_os_version() {
    OSVERSIONINFOEXW osvi = {};
    osvi.dwOSVersionInfoSize = sizeof(osvi);
    using RtlGetVersionFn = LONG(WINAPI*)(OSVERSIONINFOEXW*);
    auto RtlGetVersion = (RtlGetVersionFn)GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "RtlGetVersion");
    if (RtlGetVersion && RtlGetVersion(&osvi) == 0) {
        std::ostringstream ss;
        ss << osvi.dwMajorVersion << "." << osvi.dwMinorVersion << "." << osvi.dwBuildNumber;
        return R"({"status":")" + ss.str() + R"("})";
    }
    return R"({"status":"unknown"})";
}

int cmd_check_readiness(int argc, char* argv[]) {
    (void)argc; (void)argv;

    std::ostringstream data;
    data << R"({"platform":"win32","checks":{)"
         << R"("wgc_available":)" << check_wgc() << ","
         << R"("sendinput_available":)" << check_sendinput() << ","
         << R"("ui_automation_accessible":)" << check_uia() << ","
         << R"("dpi_awareness":)" << check_dpi() << ","
         << R"("is_elevated":)" << check_elevation() << ","
         << R"("os_version":)" << get_os_version()
         << "}}";

    understudy::write_ok(data.str());
    return 0;
}
