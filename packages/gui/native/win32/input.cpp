#include "input.h"
#include "json_output.h"
#include <windows.h>
#include <string>
#include <sstream>
#include <thread>
#include <chrono>
#include <vector>
#include <algorithm>
#include <map>

struct ArgMap {
    std::vector<std::string> positional;
    std::map<std::string, std::string> flags;

    static ArgMap parse(int argc, char* argv[]) {
        ArgMap m;
        for (int i = 0; i < argc; i++) {
            std::string arg = argv[i];
            if (arg.substr(0, 2) == "--" && i + 1 < argc) {
                m.flags[arg.substr(2)] = argv[++i];
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
        return it != flags.end() ? std::stoi(it->second) : def;
    }
};

static void move_cursor(int x, int y) {
    double sx = x * 65535.0 / (GetSystemMetrics(SM_CXSCREEN) - 1);
    double sy = y * 65535.0 / (GetSystemMetrics(SM_CYSCREEN) - 1);
    INPUT inp = {};
    inp.type = INPUT_MOUSE;
    inp.mi.dx = (LONG)sx;
    inp.mi.dy = (LONG)sy;
    inp.mi.dwFlags = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE;
    SendInput(1, &inp, sizeof(INPUT));
}

static void mouse_button(DWORD down, DWORD up, bool press, DWORD data = 0) {
    INPUT inp = {};
    inp.type = INPUT_MOUSE;
    inp.mi.dwFlags = press ? down : up;
    inp.mi.mouseData = data;
    SendInput(1, &inp, sizeof(INPUT));
}

int cmd_click(int argc, char* argv[]) {
    ArgMap args = ArgMap::parse(argc, argv);
    if (args.positional.size() < 2) {
        understudy::write_error("INTERNAL_ERROR", "click requires <x> <y>");
        return 1;
    }
    int x = std::stoi(args.positional[0]);
    int y = std::stoi(args.positional[1]);
    std::string button = args.flag("button", "left");
    int count = args.flag_int("count", 1);
    int holdMs = args.flag_int("hold-ms", 0);
    int settleMs = args.flag_int("settle-ms", 150);

    move_cursor(x, y);

    if (count == 0) {
        if (settleMs > 0)
            std::this_thread::sleep_for(std::chrono::milliseconds(settleMs));
        understudy::write_ok(R"({"action":"move"})");
        return 0;
    }

    if (settleMs > 0)
        std::this_thread::sleep_for(std::chrono::milliseconds(settleMs));

    DWORD downFlag, upFlag;
    if (button == "right") {
        downFlag = MOUSEEVENTF_RIGHTDOWN;
        upFlag = MOUSEEVENTF_RIGHTUP;
    } else if (button == "middle") {
        downFlag = MOUSEEVENTF_MIDDLEDOWN;
        upFlag = MOUSEEVENTF_MIDDLEUP;
    } else {
        downFlag = MOUSEEVENTF_LEFTDOWN;
        upFlag = MOUSEEVENTF_LEFTUP;
    }

    if (holdMs > 0) {
        mouse_button(downFlag, upFlag, true);
        std::this_thread::sleep_for(std::chrono::milliseconds(holdMs));
        mouse_button(downFlag, upFlag, false);
    } else {
        for (int i = 0; i < count; i++) {
            mouse_button(downFlag, upFlag, true);
            mouse_button(downFlag, upFlag, false);
            if (i < count - 1)
                std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
    }

    understudy::write_ok(R"({"action":"click","button":")" + button +
                         R"(","count":)" + std::to_string(count) + "}");
    return 0;
}

int cmd_type(int argc, char* argv[]) {
    ArgMap args = ArgMap::parse(argc, argv);
    if (args.positional.empty()) {
        understudy::write_error("INTERNAL_ERROR", "type requires <text>");
        return 1;
    }
    std::string text = args.positional[0];
    std::string method = args.flag("method", "unicode");
    bool replace = args.flags.count("replace") > 0;
    bool submit = args.flags.count("submit") > 0;

    if (replace) {
        INPUT inputs[4] = {};
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].ki.wVk = VK_CONTROL;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].ki.wVk = 'A';
        inputs[2].type = INPUT_KEYBOARD;
        inputs[2].ki.wVk = 'A';
        inputs[2].ki.dwFlags = KEYEVENTF_KEYUP;
        inputs[3].type = INPUT_KEYBOARD;
        inputs[3].ki.wVk = VK_CONTROL;
        inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(4, inputs, sizeof(INPUT));
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    if (method == "paste") {
        int wlen = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, nullptr, 0);
        std::vector<wchar_t> wtext(wlen);
        MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, wtext.data(), wlen);

        if (OpenClipboard(nullptr)) {
            EmptyClipboard();
            HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, wlen * sizeof(wchar_t));
            if (hMem) {
                memcpy(GlobalLock(hMem), wtext.data(), wlen * sizeof(wchar_t));
                GlobalUnlock(hMem);
                SetClipboardData(CF_UNICODETEXT, hMem);
            }
            CloseClipboard();
        }
        INPUT inputs[4] = {};
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].ki.wVk = VK_CONTROL;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].ki.wVk = 'V';
        inputs[2].type = INPUT_KEYBOARD;
        inputs[2].ki.wVk = 'V';
        inputs[2].ki.dwFlags = KEYEVENTF_KEYUP;
        inputs[3].type = INPUT_KEYBOARD;
        inputs[3].ki.wVk = VK_CONTROL;
        inputs[3].ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(4, inputs, sizeof(INPUT));
    } else if (method == "physical_keys") {
        int wlen = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, nullptr, 0);
        std::vector<wchar_t> wtext(wlen);
        MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, wtext.data(), wlen);

        for (int i = 0; i < wlen - 1; i++) {
            SHORT vk = VkKeyScanW(wtext[i]);
            if (vk == -1) continue;
            BYTE key = LOBYTE(vk);
            BYTE mods = HIBYTE(vk);
            std::vector<INPUT> inputs;
            if (mods & 1) { INPUT i = {}; i.type = INPUT_KEYBOARD; i.ki.wVk = VK_SHIFT; inputs.push_back(i); }
            if (mods & 2) { INPUT i = {}; i.type = INPUT_KEYBOARD; i.ki.wVk = VK_CONTROL; inputs.push_back(i); }
            if (mods & 4) { INPUT i = {}; i.type = INPUT_KEYBOARD; i.ki.wVk = VK_MENU; inputs.push_back(i); }
            INPUT down = {}; down.type = INPUT_KEYBOARD; down.ki.wVk = key; inputs.push_back(down);
            INPUT up = {}; up.type = INPUT_KEYBOARD; up.ki.wVk = key; up.ki.dwFlags = KEYEVENTF_KEYUP; inputs.push_back(up);
            if (mods & 4) { INPUT i = {}; i.type = INPUT_KEYBOARD; i.ki.wVk = VK_MENU; i.ki.dwFlags = KEYEVENTF_KEYUP; inputs.push_back(i); }
            if (mods & 2) { INPUT i = {}; i.type = INPUT_KEYBOARD; i.ki.wVk = VK_CONTROL; i.ki.dwFlags = KEYEVENTF_KEYUP; inputs.push_back(i); }
            if (mods & 1) { INPUT i = {}; i.type = INPUT_KEYBOARD; i.ki.wVk = VK_SHIFT; i.ki.dwFlags = KEYEVENTF_KEYUP; inputs.push_back(i); }
            SendInput((UINT)inputs.size(), inputs.data(), sizeof(INPUT));
        }
    } else {
        int wlen = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, nullptr, 0);
        std::vector<wchar_t> wtext(wlen);
        MultiByteToWideChar(CP_UTF8, 0, text.c_str(), -1, wtext.data(), wlen);

        for (int i = 0; i < wlen - 1; i++) {
            INPUT inputs[2] = {};
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].ki.wScan = wtext[i];
            inputs[0].ki.dwFlags = KEYEVENTF_UNICODE;
            inputs[1].type = INPUT_KEYBOARD;
            inputs[1].ki.wScan = wtext[i];
            inputs[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            SendInput(2, inputs, sizeof(INPUT));
        }
    }

    if (submit) {
        INPUT inputs[2] = {};
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].ki.wVk = VK_RETURN;
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].ki.wVk = VK_RETURN;
        inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(2, inputs, sizeof(INPUT));
    }

    understudy::write_ok(R"({"action":"type","method":")" + method + R"("})");
    return 0;
}

static WORD resolve_vk(const std::string& keyName) {
    static const std::map<std::string, WORD> vk_map = {
        {"enter", VK_RETURN}, {"return", VK_RETURN}, {"tab", VK_TAB},
        {"escape", VK_ESCAPE}, {"esc", VK_ESCAPE},
        {"delete", VK_BACK}, {"backspace", VK_BACK},
        {"home", VK_HOME}, {"end", VK_END},
        {"pageup", VK_PRIOR}, {"pagedown", VK_NEXT},
        {"up", VK_UP}, {"arrowup", VK_UP},
        {"down", VK_DOWN}, {"arrowdown", VK_DOWN},
        {"left", VK_LEFT}, {"arrowleft", VK_LEFT},
        {"right", VK_RIGHT}, {"arrowright", VK_RIGHT},
        {"space", VK_SPACE}, {"spacebar", VK_SPACE},
        {"f1", VK_F1}, {"f2", VK_F2}, {"f3", VK_F3}, {"f4", VK_F4},
        {"f5", VK_F5}, {"f6", VK_F6}, {"f7", VK_F7}, {"f8", VK_F8},
        {"f9", VK_F9}, {"f10", VK_F10}, {"f11", VK_F11}, {"f12", VK_F12},
        {"insert", VK_INSERT}, {"del", VK_DELETE},
        {"printscreen", VK_SNAPSHOT}, {"scrolllock", VK_SCROLL},
        {"pause", VK_PAUSE}, {"numlock", VK_NUMLOCK},
    };
    std::string lower = keyName;
    std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
    auto it = vk_map.find(lower);
    if (it != vk_map.end()) return it->second;
    if (keyName.size() == 1) return (WORD)(unsigned char)toupper(keyName[0]);
    return 0;
}

int cmd_hotkey(int argc, char* argv[]) {
    ArgMap args = ArgMap::parse(argc, argv);
    if (args.positional.empty()) {
        understudy::write_error("INTERNAL_ERROR", "hotkey requires <key>");
        return 1;
    }
    std::string keyName = args.positional[0];
    std::string modsStr = args.flag("modifiers", "");
    int repeat = args.flag_int("repeat", 1);

    WORD vk = resolve_vk(keyName);
    if (vk == 0) {
        understudy::write_error("INTERNAL_ERROR", "Unknown key: " + keyName);
        return 1;
    }

    std::vector<WORD> modVks;
    if (!modsStr.empty()) {
        std::istringstream ss(modsStr);
        std::string mod;
        while (std::getline(ss, mod, ',')) {
            std::string lower = mod;
            std::transform(lower.begin(), lower.end(), lower.begin(), ::tolower);
            if (lower == "ctrl" || lower == "control") modVks.push_back(VK_CONTROL);
            else if (lower == "alt") modVks.push_back(VK_MENU);
            else if (lower == "shift") modVks.push_back(VK_SHIFT);
            else if (lower == "win" || lower == "command") modVks.push_back(VK_LWIN);
        }
    }

    for (int r = 0; r < repeat; r++) {
        std::vector<INPUT> inputs;
        for (WORD m : modVks) {
            INPUT i = {}; i.type = INPUT_KEYBOARD; i.ki.wVk = m;
            inputs.push_back(i);
        }
        { INPUT i = {}; i.type = INPUT_KEYBOARD; i.ki.wVk = vk; inputs.push_back(i); }
        { INPUT i = {}; i.type = INPUT_KEYBOARD; i.ki.wVk = vk; i.ki.dwFlags = KEYEVENTF_KEYUP; inputs.push_back(i); }
        for (auto it = modVks.rbegin(); it != modVks.rend(); ++it) {
            INPUT i = {}; i.type = INPUT_KEYBOARD; i.ki.wVk = *it; i.ki.dwFlags = KEYEVENTF_KEYUP;
            inputs.push_back(i);
        }
        SendInput((UINT)inputs.size(), inputs.data(), sizeof(INPUT));
        if (r < repeat - 1)
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    understudy::write_ok(R"({"action":"hotkey","key":")" + keyName + R"("})");
    return 0;
}

int cmd_scroll(int argc, char* argv[]) {
    ArgMap args = ArgMap::parse(argc, argv);
    if (args.positional.size() < 4) {
        understudy::write_error("INTERNAL_ERROR", "scroll requires <x> <y> <deltaX> <deltaY>");
        return 1;
    }
    int x = std::stoi(args.positional[0]);
    int y = std::stoi(args.positional[1]);
    int deltaX = std::stoi(args.positional[2]);
    int deltaY = std::stoi(args.positional[3]);
    std::string unit = args.flag("unit", "line");

    move_cursor(x, y);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    if (deltaY != 0) {
        INPUT inp = {};
        inp.type = INPUT_MOUSE;
        inp.mi.dwFlags = MOUSEEVENTF_WHEEL;
        if (unit == "pixel") {
            inp.mi.mouseData = (DWORD)deltaY;
        } else {
            inp.mi.mouseData = (DWORD)(deltaY * WHEEL_DELTA);
        }
        SendInput(1, &inp, sizeof(INPUT));
    }

    if (deltaX != 0) {
        INPUT inp = {};
        inp.type = INPUT_MOUSE;
        inp.mi.dwFlags = MOUSEEVENTF_HWHEEL;
        if (unit == "pixel") {
            inp.mi.mouseData = (DWORD)deltaX;
        } else {
            inp.mi.mouseData = (DWORD)(deltaX * WHEEL_DELTA);
        }
        SendInput(1, &inp, sizeof(INPUT));
    }

    understudy::write_ok(R"({"action":"scroll","deltaX":)" + std::to_string(deltaX)
        + R"(,"deltaY":)" + std::to_string(deltaY) + "}");
    return 0;
}

int cmd_drag(int argc, char* argv[]) {
    ArgMap args = ArgMap::parse(argc, argv);
    if (args.positional.size() < 4) {
        understudy::write_error("INTERNAL_ERROR", "drag requires <fromX> <fromY> <toX> <toY>");
        return 1;
    }
    int fromX = std::stoi(args.positional[0]);
    int fromY = std::stoi(args.positional[1]);
    int toX = std::stoi(args.positional[2]);
    int toY = std::stoi(args.positional[3]);
    int durationMs = args.flag_int("duration", 300);
    int steps = 24;

    move_cursor(fromX, fromY);
    std::this_thread::sleep_for(std::chrono::milliseconds(100));

    mouse_button(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, true);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));

    for (int i = 1; i <= steps; i++) {
        double t = (double)i / steps;
        int cx = fromX + (int)((toX - fromX) * t);
        int cy = fromY + (int)((toY - fromY) * t);
        move_cursor(cx, cy);
        std::this_thread::sleep_for(std::chrono::milliseconds(durationMs / steps));
    }

    mouse_button(MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, false);

    understudy::write_ok(R"({"action":"drag"})");
    return 0;
}
