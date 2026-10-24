// Byte-level text decoding: BOM/CR detection, line splitting, fenced-code tracking.
#pragma once

#include <cstddef>
#include <string>
#include <string_view>
#include <vector>

namespace docguard {

// Extensions the line-ending and byte-order-mark rules apply to.
bool has_tracked_text_extension(std::string_view relative_path);

struct TextFile {
    std::string bytes;
    std::vector<std::string> lines;  // LF split, trailing CR removed, BOM stripped
    bool has_bom = false;
    bool has_crlf = false;
    std::size_t crlf_count = 0;
    std::size_t first_crlf_line = 0;  // 1-based, 0 when there is no CRLF
};

TextFile decode_text(std::string bytes);

// Tracks whether the reader is currently inside a fenced code block. Feed every line in
// order, then ask `inside()`; the opening fence line already reports `true`.
class FenceTracker {
public:
    bool inside() const { return inside_; }
    void feed(std::string_view line);

private:
    bool inside_ = false;
    char marker_ = 0;
    std::size_t length_ = 0;
};

}  // namespace docguard
