#include "strutil.hpp"

#include <algorithm>

namespace docguard {

bool is_ascii_word_byte(char value) {
    const unsigned char byte = static_cast<unsigned char>(value);
    return (byte >= '0' && byte <= '9') || (byte >= 'A' && byte <= 'Z') ||
           (byte >= 'a' && byte <= 'z') || byte == '_';
}

bool is_ascii_digit(char value) {
    return value >= '0' && value <= '9';
}

bool is_ascii_space(char value) {
    return value == ' ' || value == '\t' || value == '\r' || value == '\n' || value == '\v' ||
           value == '\f';
}

char lower_ascii(char value) {
    if (value >= 'A' && value <= 'Z') return static_cast<char>(value - 'A' + 'a');
    return value;
}

std::string to_lower_ascii(std::string_view text) {
    std::string lowered;
    lowered.reserve(text.size());
    for (char value : text) lowered.push_back(lower_ascii(value));
    return lowered;
}

bool is_ascii_only(std::string_view text) {
    for (char value : text) {
        if (static_cast<unsigned char>(value) > 0x7F) return false;
    }
    return true;
}

std::string_view trim_view(std::string_view text) {
    std::size_t begin = 0;
    std::size_t end = text.size();
    while (begin < end && is_ascii_space(text[begin])) ++begin;
    while (end > begin && is_ascii_space(text[end - 1])) --end;
    return text.substr(begin, end - begin);
}

std::string trim(std::string_view text) {
    return std::string(trim_view(text));
}

bool starts_with(std::string_view text, std::string_view prefix) {
    return text.size() >= prefix.size() && text.compare(0, prefix.size(), prefix) == 0;
}

bool ends_with(std::string_view text, std::string_view suffix) {
    return text.size() >= suffix.size() &&
           text.compare(text.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool contains_case_insensitive(std::string_view haystack, std::string_view needle) {
    if (needle.empty()) return true;
    if (needle.size() > haystack.size()) return false;
    const std::size_t last = haystack.size() - needle.size();
    for (std::size_t offset = 0; offset <= last; ++offset) {
        bool matched = true;
        for (std::size_t index = 0; index < needle.size(); ++index) {
            if (lower_ascii(haystack[offset + index]) != lower_ascii(needle[index])) {
                matched = false;
                break;
            }
        }
        if (matched) return true;
    }
    return false;
}

bool contains_whole_word_case_insensitive(std::string_view haystack, std::string_view needle) {
    if (needle.empty()) return false;
    if (needle.size() > haystack.size()) return false;
    const std::size_t last = haystack.size() - needle.size();
    for (std::size_t offset = 0; offset <= last; ++offset) {
        bool matched = true;
        for (std::size_t index = 0; index < needle.size(); ++index) {
            if (lower_ascii(haystack[offset + index]) != lower_ascii(needle[index])) {
                matched = false;
                break;
            }
        }
        if (!matched) continue;
        if (offset > 0 && is_ascii_word_byte(haystack[offset - 1])) continue;
        const std::size_t after = offset + needle.size();
        if (after < haystack.size() && is_ascii_word_byte(haystack[after])) continue;
        return true;
    }
    return false;
}

std::vector<std::string> split(std::string_view text, char separator) {
    std::vector<std::string> parts;
    std::size_t begin = 0;
    while (true) {
        const std::size_t position = text.find(separator, begin);
        if (position == std::string_view::npos) {
            parts.emplace_back(text.substr(begin));
            break;
        }
        parts.emplace_back(text.substr(begin, position - begin));
        begin = position + 1;
    }
    return parts;
}

}  // namespace docguard
