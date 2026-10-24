#include "text_file.hpp"

#include <array>

#include "strutil.hpp"

namespace docguard {
namespace {

struct FenceDelimiter {
    bool found = false;
    char marker = 0;
    std::size_t length = 0;
    std::string_view remainder;
};

FenceDelimiter detect_fence(std::string_view line) {
    FenceDelimiter result;
    if (line.size() < 3) return result;
    const char marker = line[0];
    if (marker != '`' && marker != '~') return result;
    std::size_t length = 0;
    while (length < line.size() && line[length] == marker) ++length;
    if (length < 3) return result;
    result.found = true;
    result.marker = marker;
    result.length = length;
    result.remainder = line.substr(length);
    return result;
}

}  // namespace

bool has_tracked_text_extension(std::string_view relative_path) {
    const std::size_t dot = relative_path.rfind('.');
    if (dot == std::string_view::npos || dot + 1 >= relative_path.size()) return false;
    const std::string extension = to_lower_ascii(relative_path.substr(dot + 1));
    static constexpr std::array<std::string_view, 13> kExtensions = {
        "md", "json", "toml", "ps1", "py",    "ini",  "cfg",
        "txt", "mjs", "js",   "ts",  "yaml", "yml"};
    for (std::string_view candidate : kExtensions) {
        if (extension == candidate) return true;
    }
    return false;
}

TextFile decode_text(std::string bytes) {
    TextFile file;
    file.bytes = std::move(bytes);
    const std::string& raw = file.bytes;

    std::size_t start = 0;
    if (raw.size() >= 3 && static_cast<unsigned char>(raw[0]) == 0xEF &&
        static_cast<unsigned char>(raw[1]) == 0xBB && static_cast<unsigned char>(raw[2]) == 0xBF) {
        file.has_bom = true;
        start = 3;
    }

    std::size_t line_start = start;
    for (std::size_t index = start; index <= raw.size(); ++index) {
        if (index == raw.size()) {
            std::size_t end = index;
            if (end > line_start && raw[end - 1] == '\r') --end;
            file.lines.emplace_back(raw.substr(line_start, end - line_start));
            break;
        }
        if (raw[index] != '\n') continue;
        std::size_t end = index;
        if (end > line_start && raw[end - 1] == '\r') --end;
        file.lines.emplace_back(raw.substr(line_start, end - line_start));
        line_start = index + 1;
    }

    // A CR byte is only a line-ending problem when it is the CR of a CRLF pair: a lone
    // CR is not judged here, because whether it is a line ending at all is a property of
    // the platform that produced the file.
    std::size_t line = 1;
    for (std::size_t index = 0; index < raw.size(); ++index) {
        if (raw[index] == '\n') {
            ++line;
            continue;
        }
        if (raw[index] != '\r') continue;
        if (index + 1 >= raw.size() || raw[index + 1] != '\n') continue;
        ++file.crlf_count;
        if (file.first_crlf_line == 0) file.first_crlf_line = line;
    }
    file.has_crlf = file.crlf_count > 0;
    return file;
}

void FenceTracker::feed(std::string_view line) {
    const FenceDelimiter delimiter = detect_fence(trim_view(line));
    if (!delimiter.found) return;

    if (!inside_) {
        inside_ = true;
        marker_ = delimiter.marker;
        length_ = delimiter.length;
        return;
    }
    if (delimiter.marker != marker_ || delimiter.length < length_) return;
    for (char value : delimiter.remainder) {
        if (value != marker_ && !is_ascii_space(value)) return;
    }
    inside_ = false;
    marker_ = 0;
    length_ = 0;
}

}  // namespace docguard
