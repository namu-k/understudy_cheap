#pragma once
#include <string>
#include <iostream>
#include <sstream>

namespace understudy {

// Escape a string for safe embedding inside a JSON string literal
inline std::string escape_json(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (unsigned char c : s) {
        if (c == '"')       out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else if (c == '\t') out += "\\t";
        else if (c < 0x20) {
            char buf[7];
            snprintf(buf, sizeof(buf), "\\u%04x", c);
            out += buf;
        } else {
            out += static_cast<char>(c);
        }
    }
    return out;
}

// Write {"status":"ok","data":{...}} to stdout
inline void write_ok(const std::string& data_json) {
    std::cout << R"({"status":"ok","data":)" << data_json << "}" << std::endl;
}

// Write {"status":"error","code":"...","message":"..."} to stdout
inline void write_error(const std::string& code, const std::string& message) {
    // Escape quotes in message
    std::string escaped;
    for (char c : message) {
        if (c == '"') escaped += "\\\"";
        else if (c == '\\') escaped += "\\\\";
        else if (c == '\n') escaped += "\\n";
        else if (c == '\r') escaped += "\\r";
        else if (c == '\t') escaped += "\\t";
        else escaped += c;
    }
    std::cout << R"({"status":"error","code":")" << code
              << R"(","message":")" << escaped << R"("})" << std::endl;
}

// Write diagnostic messages to stderr (ignored by TS parser)
inline void log(const std::string& msg) {
    std::cerr << msg << std::endl;
}

} // namespace understudy
