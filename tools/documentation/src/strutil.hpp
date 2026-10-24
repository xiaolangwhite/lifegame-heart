// Small ASCII-aware string helpers (UTF-8 payload bytes are passed through untouched).
#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace docguard {

bool is_ascii_word_byte(char value);
bool is_ascii_digit(char value);
bool is_ascii_space(char value);
char lower_ascii(char value);
std::string to_lower_ascii(std::string_view text);
bool is_ascii_only(std::string_view text);

std::string_view trim_view(std::string_view text);
std::string trim(std::string_view text);

bool starts_with(std::string_view text, std::string_view prefix);
bool ends_with(std::string_view text, std::string_view suffix);

bool contains_case_insensitive(std::string_view haystack, std::string_view needle);

// Case-insensitive search that demands a non-word byte on both sides, so `PENDING`
// never matches `PENDINGLY`. Non-ASCII neighbours count as boundaries, which is what
// the CJK placeholder tokens rely on.
bool contains_whole_word_case_insensitive(std::string_view haystack, std::string_view needle);

std::vector<std::string> split(std::string_view text, char separator);

}  // namespace docguard
