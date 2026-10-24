#include "repo_scan.hpp"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <system_error>
#include <thread>

#include "strutil.hpp"

namespace docguard {
namespace {

// Directories that never hold documentation under review: version control metadata,
// package manager payloads, redirected caches and the tool's own build/test output.
const std::vector<std::string>& ignored_prefixes() {
    static const std::vector<std::string> kPrefixes = {
        ".git",
        ".venv",
        "node_modules",
        "__pycache__",
        ".cache",
        ".pytest_cache",
        ".ruff_cache",
        ".mypy_cache",
        "TEMP",
        "tools/documentation/build",
        "tools/documentation/tests/fixtures",
    };
    return kPrefixes;
}

}  // namespace

std::filesystem::path path_from_utf8(const std::string& text) {
#ifdef _WIN32
    const std::u8string utf8(reinterpret_cast<const char8_t*>(text.data()), text.size());
    return std::filesystem::path(utf8);
#else
    return std::filesystem::path(text);
#endif
}

std::string to_utf8(const std::filesystem::path& path) {
    const std::u8string utf8 = path.generic_u8string();
    return std::string(reinterpret_cast<const char*>(utf8.data()), utf8.size());
}

std::optional<std::string> read_file_bytes(const std::filesystem::path& path, std::string& error) {
    for (int attempt = 0; attempt < 5; ++attempt) {
        std::FILE* handle = nullptr;
#ifdef _WIN32
        handle = ::_wfopen(path.c_str(), L"rb");
#else
        handle = std::fopen(path.c_str(), "rb");
#endif
        if (handle == nullptr) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
            continue;
        }
        std::string data;
        char buffer[65536];
        std::size_t read = 0;
        while ((read = std::fread(buffer, 1, sizeof(buffer), handle)) > 0) {
            data.append(buffer, read);
        }
        const bool failed = std::ferror(handle) != 0;
        std::fclose(handle);
        if (failed) {
            error = "read error";
            return std::nullopt;
        }
        return data;
    }
    error = "cannot open file for reading";
    return std::nullopt;
}

const std::vector<std::string>& RepoTree::ignore_prefixes() { return ignored_prefixes(); }

bool RepoTree::ignored(const std::string& relative) {
    for (const std::string& prefix : ignored_prefixes()) {
        if (relative == prefix) return true;
        if (relative.size() > prefix.size() &&
            relative.compare(0, prefix.size(), prefix) == 0 && relative[prefix.size()] == '/') {
            return true;
        }
    }
    return false;
}

std::optional<RepoTree> RepoTree::build(const std::filesystem::path& root, std::string& error) {
    RepoTree tree;
    tree.root_ = std::filesystem::absolute(root).lexically_normal();
    tree.display_root_ = to_utf8(tree.root_);

    std::error_code status_error;
    if (!std::filesystem::is_directory(tree.root_, status_error)) {
        error = "scan root is not an existing directory: " + tree.display_root_;
        return std::nullopt;
    }

    std::error_code iterator_error;
    std::filesystem::recursive_directory_iterator iterator(
        tree.root_, std::filesystem::directory_options::skip_permission_denied, iterator_error);
    if (iterator_error) {
        error = "cannot enumerate scan root: " + tree.display_root_ + " (" + iterator_error.message() +
                ")";
        return std::nullopt;
    }

    const std::filesystem::recursive_directory_iterator end;
    for (; iterator != end; iterator.increment(iterator_error)) {
        if (iterator_error) {
            iterator_error.clear();
            continue;
        }
        const std::filesystem::directory_entry& entry = *iterator;
        const std::string relative = to_utf8(entry.path().lexically_relative(tree.root_));
        if (relative.empty() || relative == ".") continue;

        std::error_code entry_error;
        const bool directory = entry.is_directory(entry_error);
        if (ignored(relative)) {
            if (directory) iterator.disable_recursion_pending();
            continue;
        }
        tree.entries_.push_back(TreeEntry{relative, directory});
    }

    std::sort(tree.entries_.begin(), tree.entries_.end(),
              [](const TreeEntry& left, const TreeEntry& right) { return left.path < right.path; });
    return tree;
}

std::filesystem::path RepoTree::absolute(const std::string& relative) const {
    return root_ / path_from_utf8(relative);
}

bool RepoTree::exists(const std::string& relative) const {
    std::error_code status_error;
    return std::filesystem::exists(absolute(relative), status_error);
}

bool RepoTree::is_directory(const std::string& relative) const {
    std::error_code status_error;
    return std::filesystem::is_directory(absolute(relative), status_error);
}

bool RepoTree::is_regular_file(const std::string& relative) const {
    std::error_code status_error;
    return std::filesystem::is_regular_file(absolute(relative), status_error);
}

const TextFile* RepoTree::text(const std::string& relative) const {
    const auto cached = text_cache_.find(relative);
    if (cached != text_cache_.end()) return &cached->second;

    // A path that does not exist is not an IO failure: whether it *must* exist is the
    // business of the layout rule, not of the reader.
    std::error_code exists_error;
    if (!std::filesystem::exists(absolute(relative), exists_error)) {
        text_cache_.emplace(relative, TextFile{});
        return nullptr;
    }

    std::string error;
    std::optional<std::string> bytes = read_file_bytes(absolute(relative), error);
    if (!bytes.has_value()) {
        text_cache_.emplace(relative, TextFile{});
        io_failures_.push_back(relative + ": " + error);
        return nullptr;
    }
    const auto inserted = text_cache_.emplace(relative, decode_text(std::move(*bytes)));
    return &inserted.first->second;
}

}  // namespace docguard
