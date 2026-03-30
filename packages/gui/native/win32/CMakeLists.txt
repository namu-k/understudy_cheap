cmake_minimum_required(VERSION 3.20)
project(understudy-win32-helper LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# C++/WinRT for WGC
find_package(CppWinRT CONFIG QUIET)

add_executable(understudy-win32-helper
    main.cpp
    input.cpp
    capture.cpp
    windows_mgmt.cpp
    readiness.cpp
    event_recorder.cpp
)

target_link_libraries(understudy-win32-helper PRIVATE
    windowsapp
    user32
    gdi32
    ole32
    oleaut32
    dwmapi
    d3d11
    dxgi
    shcore
    psapi
)

# DPI manifest
target_sources(understudy-win32-helper PRIVATE
    $<$<CXX_COMPILER_ID:MSVC>:${CMAKE_CURRENT_SOURCE_DIR}/app.manifest>
)

# Static runtime to avoid vcruntime dependency
if(MSVC)
    set_property(TARGET understudy-win32-helper PROPERTY
        MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()
