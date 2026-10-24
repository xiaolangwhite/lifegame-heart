// Repository traversal: deterministic entry list plus cached, encoding-safe file reads.
#pragma once

#include <filesystem>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "text_file.hpp"

namespace docguard {

struct TreeEntry {
    std::string path;  // relative to the scan root, '/' separated
    bool directory = false;
};

class RepoTree {
public:
    static std::optional<RepoTree> build(const std::filesystem::path& root, std::string& error);

    const std::filesystem::path& root() const { return root_; }
    // Absolute root rendered as UTF-8 with '/' separators (used by the JSON report).
    const std::string& display_root() const { return display_root_; }
    const std::vector<TreeEntry>& entries() const { return entries_; }

    bool exists(const std::string& relative) const;
    bool is_directory(const std::string& relative) const;
    bool is_regular_file(const std::string& relative) const;

    // Cached decode of a text file. Returns nullptr when the file is absent or unreadable;
    // an unreadable file is also recorded as an IO failure.
    const TextFile* text(const std::string& relative) const;

    const std::vector<std::string>& io_failures() const { return io_failures_; }

    static bool ignored(const std::string& relative);
    static const std::vector<std::string>& ignore_prefixes();

private:
    std::filesystem::path absolute(const std::string& relative) const;

    std::filesystem::path root_;
    std::string display_root_;
    std::vector<TreeEntry> entries_;
    mutable std::map<std::string, TextFile> text_cache_;
    mutable std::vector<std::string> io_failures_;
};

// Reads a whole file as raw bytes. Windows uses the wide-character CRT entry point so
// roots containing non-ASCII characters keep working.
std::optional<std::string> read_file_bytes(const std::filesystem::path& path, std::string& error);

// Converts a UTF-8 byte string into a native path (lossless on Windows).
std::filesystem::path path_from_utf8(const std::string& text);
std::string to_utf8(const std::filesystem::path& path);

}  // namespace docguard
