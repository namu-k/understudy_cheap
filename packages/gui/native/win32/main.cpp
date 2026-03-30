#include <windows.h>
#include <shellscalingapi.h>
#include <string>
#include <iostream>
#include "json_output.h"

// Forward declarations for subcommands
int cmd_click(int argc, char* argv[]);
int cmd_type(int argc, char* argv[]);
int cmd_hotkey(int argc, char* argv[]);
int cmd_scroll(int argc, char* argv[]);
int cmd_drag(int argc, char* argv[]);
int cmd_screenshot(int argc, char* argv[]);
int cmd_enumerate_windows(int argc, char* argv[]);
int cmd_activate_window(int argc, char* argv[]);
int cmd_capture_context(int argc, char* argv[]);
int cmd_check_readiness(int argc, char* argv[]);
int cmd_record_events(int argc, char* argv[]);

static void set_dpi_awareness() {
    // Try Per-Monitor V2 first (Win10 1703+)
    if (!SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) {
        // Fall back to Per-Monitor V1 (Win8.1+)
        SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE);
    }
}

int main(int argc, char* argv[]) {
    set_dpi_awareness();

    if (argc < 2) {
        understudy::write_error("INTERNAL_ERROR", "Usage: understudy-win32-helper <subcommand> [args...]");
        return 1;
    }

    std::string cmd = argv[1];
    int sub_argc = argc - 2;
    char** sub_argv = argv + 2;

    if (cmd == "click")             return cmd_click(sub_argc, sub_argv);
    if (cmd == "type")              return cmd_type(sub_argc, sub_argv);
    if (cmd == "hotkey")            return cmd_hotkey(sub_argc, sub_argv);
    if (cmd == "scroll")            return cmd_scroll(sub_argc, sub_argv);
    if (cmd == "drag")              return cmd_drag(sub_argc, sub_argv);
    if (cmd == "screenshot")        return cmd_screenshot(sub_argc, sub_argv);
    if (cmd == "enumerate-windows") return cmd_enumerate_windows(sub_argc, sub_argv);
    if (cmd == "activate-window")   return cmd_activate_window(sub_argc, sub_argv);
    if (cmd == "capture-context")   return cmd_capture_context(sub_argc, sub_argv);
    if (cmd == "check-readiness")   return cmd_check_readiness(sub_argc, sub_argv);
    if (cmd == "record-events")     return cmd_record_events(sub_argc, sub_argv);

    understudy::write_error("INTERNAL_ERROR", "Unknown subcommand: " + cmd);
    return 1;
}
