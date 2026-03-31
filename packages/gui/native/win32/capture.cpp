#include "capture.h"
#include "json_output.h"
#include <windows.h>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <string>
#include <vector>
#include <fstream>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

static bool capture_wgc(const std::string& outputPath, int displayIndex, const std::string& windowTitle, bool includeCursor);

static bool capture_gdi(const std::string& outputPath, int displayIndex, bool includeCursor) {
    HDC hScreen = GetDC(nullptr);
    int width = GetSystemMetrics(SM_CXSCREEN);
    int height = GetSystemMetrics(SM_CYSCREEN);

    HDC hMemDC = CreateCompatibleDC(hScreen);
    HBITMAP hBitmap = CreateCompatibleBitmap(hScreen, width, height);
    SelectObject(hMemDC, hBitmap);
    BitBlt(hMemDC, 0, 0, width, height, hScreen, 0, 0, SRCCOPY);

    if (includeCursor) {
        CURSORINFO ci = {};
        ci.cbSize = sizeof(ci);
        if (GetCursorInfo(&ci) && ci.flags == CURSOR_SHOWING) {
            DrawIconEx(hMemDC, ci.ptScreenPos.x, ci.ptScreenPos.y, ci.hCursor, 0, 0, 0, nullptr, DI_NORMAL);
        }
    }

    BITMAPINFOHEADER bi = {};
    bi.biSize = sizeof(bi);
    bi.biWidth = width;
    bi.biHeight = -height;
    bi.biPlanes = 1;
    bi.biBitCount = 32;
    bi.biCompression = BI_RGB;

    std::vector<uint8_t> pixels(static_cast<size_t>(width) * height * 4);
    GetDIBits(hMemDC, hBitmap, 0, height, pixels.data(), (BITMAPINFO*)&bi, DIB_RGB_COLORS);

    for (size_t i = 0; i < pixels.size(); i += 4) {
        std::swap(pixels[i], pixels[i + 2]);
    }

    DeleteObject(hBitmap);
    DeleteDC(hMemDC);
    ReleaseDC(nullptr, hScreen);

    return stbi_write_png(outputPath.c_str(), width, height, 4, pixels.data(), width * 4) != 0;
}

int cmd_screenshot(int argc, char* argv[]) {
    if (argc < 1) {
        understudy::write_error("INTERNAL_ERROR", "screenshot requires <outputPath>");
        return 1;
    }
    std::string outputPath = argv[0];

    int displayIndex = 0;
    std::string windowTitle;
    bool includeCursor = false;
    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];
        if (arg == "--display" && i + 1 < argc) {
            try { displayIndex = std::stoi(argv[++i]); } catch (...) { displayIndex = 0; }
        }
        else if (arg == "--window-title" && i + 1 < argc) windowTitle = argv[++i];
        else if (arg == "--include-cursor") includeCursor = true;
    }

    bool ok = capture_wgc(outputPath, displayIndex, windowTitle, includeCursor);
    if (!ok) {
        understudy::log("WGC capture failed, falling back to GDI BitBlt");
        ok = capture_gdi(outputPath, displayIndex, includeCursor);
    }

    if (!ok) {
        understudy::write_error("INTERNAL_ERROR", "Screenshot capture failed");
        return 1;
    }

    understudy::write_ok(R"({"path":")" + outputPath + R"(","method":"gdi_fallback"})");
    return 0;
}

static bool capture_wgc(const std::string& outputPath, int displayIndex, const std::string& windowTitle, bool includeCursor) {
    // TODO: Phase 2 — full WGC implementation via C++/WinRT
    return false;
}
