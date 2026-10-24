// Markdown body rules: links, status vocabulary, placeholder markers, absolute paths.
#include <cstddef>
#include <string>
#include <vector>

#include "rules.hpp"
#include "strutil.hpp"
#include "text_file.hpp"

namespace docguard {
namespace {

struct LinkTarget {
    std::string raw;
};

// Finds inline `[text](target)` links in one line. Escapes are honoured, angle brackets
// delimit targets that contain spaces, and parentheses nest.
std::vector<LinkTarget> find_links(std::string_view line) {
    std::vector<LinkTarget> links;
    std::size_t position = 0;
    while (position < line.size()) {
        if (line[position] != '[' || (position > 0 && line[position - 1] == '\\')) {
            ++position;
            continue;
        }
        std::size_t close = position + 1;
        int bracket_depth = 0;
        bool bracket_found = false;
        for (; close < line.size(); ++close) {
            const char value = line[close];
            if (value == '\\') {
                ++close;
                continue;
            }
            if (value == '[') {
                ++bracket_depth;
                continue;
            }
            if (value != ']') continue;
            if (bracket_depth == 0) {
                bracket_found = true;
                break;
            }
            --bracket_depth;
        }
        if (!bracket_found) {
            ++position;
            continue;
        }
        const std::size_t open = close + 1;
        if (open >= line.size() || line[open] != '(') {
            position = close + 1;
            continue;
        }
        std::string target;
        bool closed = false;
        bool in_angle = false;
        int paren_depth = 0;
        std::size_t cursor = open + 1;
        for (; cursor < line.size(); ++cursor) {
            const char value = line[cursor];
            if (value == '\\' && cursor + 1 < line.size()) {
                target.push_back(line[cursor + 1]);
                ++cursor;
                continue;
            }
            if (value == '<' && !in_angle && target.empty()) {
                in_angle = true;
                continue;
            }
            if (value == '>' && in_angle) {
                in_angle = false;
                continue;
            }
            if (value == '(' && !in_angle) {
                ++paren_depth;
                target.push_back(value);
                continue;
            }
            if (value == ')') {
                if (in_angle) {
                    target.push_back(value);
                    continue;
                }
                if (paren_depth == 0) {
                    closed = true;
                    break;
                }
                --paren_depth;
                target.push_back(value);
                continue;
            }
            target.push_back(value);
        }
        if (closed) links.push_back(LinkTarget{target});
        position = (closed ? cursor : close) + 1;
    }
    return links;
}

// Drops a markdown title suffix: `path "Title"` or `path 'Title'`.
std::string strip_title(std::string_view target) {
    for (std::size_t index = 0; index + 1 < target.size(); ++index) {
        if (!is_ascii_space(target[index])) continue;
        const char next = target[index + 1];
        if (next != '"' && next != '\'') continue;
        return std::string(target.substr(0, index));
    }
    return std::string(target);
}

void decode_percent_escapes(std::string& text) {
    std::string decoded;
    decoded.reserve(text.size());
    for (std::size_t index = 0; index < text.size(); ++index) {
        if (text[index] != '%' || index + 2 >= text.size()) {
            decoded.push_back(text[index]);
            continue;
        }
        const auto hex = [](char value, int& out) {
            if (value >= '0' && value <= '9') {
                out = value - '0';
                return true;
            }
            if (value >= 'a' && value <= 'f') {
                out = value - 'a' + 10;
                return true;
            }
            if (value >= 'A' && value <= 'F') {
                out = value - 'A' + 10;
                return true;
            }
            return false;
        };
        int high = 0;
        int low = 0;
        if (hex(text[index + 1], high) && hex(text[index + 2], low)) {
            decoded.push_back(static_cast<char>((high << 4) | low));
            index += 2;
            continue;
        }
        decoded.push_back(text[index]);
    }
    text = std::move(decoded);
}

bool has_uri_scheme(std::string_view target) {
    if (target.empty()) return false;
    const char first = target[0];
    if (!((first >= 'A' && first <= 'Z') || (first >= 'a' && first <= 'z'))) return false;
    for (std::size_t index = 1; index < target.size(); ++index) {
        const char value = target[index];
        if (value == ':') return true;
        const bool allowed = (value >= 'A' && value <= 'Z') || (value >= 'a' && value <= 'z') ||
                             (value >= '0' && value <= '9') || value == '+' || value == '-' ||
                             value == '.';
        if (!allowed) return false;
    }
    return false;
}

bool link_target_exists(const RepoTree& tree, const std::string& containing_file,
                        const std::string& raw_target) {
    std::string target = strip_title(trim_view(raw_target));
    if (target.empty()) return true;
    const std::size_t fragment = target.find('#');
    if (fragment != std::string::npos) target = target.substr(0, fragment);
    target = trim(target);
    if (target.empty()) return true;  // pure anchor
    if (starts_with(target, "//") || has_uri_scheme(target)) return true;
    decode_percent_escapes(target);

    std::filesystem::path resolved;
    if (target[0] == '/') {
        resolved = path_from_utf8(target.substr(1));
    } else {
        const std::size_t slash = containing_file.rfind('/');
        const std::string base = slash == std::string::npos ? std::string() : containing_file.substr(0, slash + 1);
        resolved = path_from_utf8(base + target);
    }
    const std::string relative = to_utf8(resolved.lexically_normal());
    if (relative.empty()) return true;
    return tree.exists(relative);
}

const char* const kPlaceholderTokens[] = {"TODO", "TBD", "FIXME", "PLACEHOLDER", "XXX"};

const char* const kPlaceholderPhrases[] = {
    "\xE5\xBE\x85\xE8\xA1\xA5\xE5\x85\x85",  // CJK marker
    "\xE5\xBE\x85\xE5\xAE\x9A",              // CJK marker
};

const char* const kStatusVocabulary[] = {
    "Partially Implemented", "Implemented",   "User Paused", "Future Goal", "Unvalidated",
    "Validated",             "Superseded",    "Deprecated",  "Proposed",    "Rejected",
    "Planned",
};

std::string status_value_of(std::string_view line, bool& found) {
    found = false;
    const std::string lowered = to_lower_ascii(line);
    const std::size_t bold = lowered.find("**status:**");
    if (bold != std::string::npos) {
        found = true;
        return trim(line.substr(bold + 11));
    }
    const std::string_view trimmed = trim_view(line);
    if (trimmed.size() >= 7 && to_lower_ascii(trimmed.substr(0, 7)) == "status:") {
        found = true;
        return trim(trimmed.substr(7));
    }
    return {};
}

bool is_known_status(std::string_view value) {
    for (const char* candidate : kStatusVocabulary) {
        const std::string_view word(candidate);
        if (value.size() < word.size()) continue;
        if (to_lower_ascii(value.substr(0, word.size())) != to_lower_ascii(word)) continue;
        const std::size_t after = word.size();
        if (after < value.size() && is_ascii_word_byte(value[after])) continue;
        return true;
    }
    return false;
}

std::string shorten(std::string_view text, std::size_t limit) {
    if (text.size() <= limit) return std::string(text);
    return std::string(text.substr(0, limit)) + "...";
}

}  // namespace

void check_markdown(const RepoTree& tree, ViolationSink& sink) {
    for (const TreeEntry& entry : tree.entries()) {
        if (entry.directory || !is_markdown(entry.path)) continue;
        const bool link_scope = entry.path == "README.md" || entry.path == "AGENTS.md" ||
                                entry.path == "ENGINE_STANDARD.md" || is_docs_markdown(entry.path);
        const bool absolute_path_scope = is_docs_markdown(entry.path);
        if (!link_scope && !absolute_path_scope) continue;

        const TextFile* file = tree.text(entry.path);
        if (file == nullptr) continue;

        FenceTracker fence;
        for (std::size_t index = 0; index < file->lines.size(); ++index) {
            const std::string& line = file->lines[index];
            fence.feed(line);
            const int line_number = static_cast<int>(index + 1);
            const bool inside_fence = fence.inside();

            if (link_scope) {
                for (const LinkTarget& link : find_links(line)) {
                    if (link_target_exists(tree, entry.path, link.raw)) continue;
                    sink.add_error(codes::MarkdownLinkBroken, entry.path, line_number,
                                   "markdown link target does not exist: " +
                                       shorten(trim_view(link.raw), 120));
                }
            }

            if (absolute_path_scope && !inside_fence) {
                const std::string lowered = to_lower_ascii(line);
                if (lowered.find("c:\\") != std::string::npos ||
                    lowered.find("c:/") != std::string::npos) {
                    sink.add_warn(codes::AbsolutePathInDocs, entry.path, line_number,
                                  "documentation mentions an absolute Windows path (C:)");
                }
            }

            if (!inside_fence) {
                std::vector<std::string> found;
                for (const char* token : kPlaceholderTokens) {
                    if (contains_whole_word_case_insensitive(line, token)) found.emplace_back(token);
                }
                for (const char* phrase : kPlaceholderPhrases) {
                    if (contains_whole_word_case_insensitive(line, phrase)) found.emplace_back(phrase);
                }
                if (!found.empty()) {
                    std::string message = "placeholder marker in document text:";
                    for (const std::string& token : found) message += " " + token;
                    sink.add_error(codes::Placeholder, entry.path, line_number, std::move(message));
                }
            }

            bool has_status = false;
            const std::string value = status_value_of(line, has_status);
            if (!has_status) continue;
            if (value.empty()) {
                sink.add_error(codes::StatusVocabulary, entry.path, line_number,
                               "status declaration carries no value");
                continue;
            }
            if (is_known_status(value)) continue;
            sink.add_error(codes::StatusVocabulary, entry.path, line_number,
                           "unknown status value \"" + shorten(value, 80) +
                               "\" (see the closed status vocabulary)");
        }
    }
}

}  // namespace docguard
