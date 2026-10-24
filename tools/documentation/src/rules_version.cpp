// Version rules: number syntax, authority leaks, and the VERSIONS.md table declaration.
#include <cstddef>
#include <string>
#include <vector>

#include "rules.hpp"
#include "strutil.hpp"
#include "text_file.hpp"

namespace docguard {
namespace {

const char* const kVersionAuthorityFiles[] = {
    "README.md",
    "docs/README.md",
    "docs/plan/README.md",
    "docs/plan/ROADMAP.md",
    "docs/MODULE_FLOW_GUIDE.md",
};

struct LeakPhrase {
    const char* ascii;
    const char* literal;
};

// The two ASCII phrases are matched case-insensitively; the CJK phrases are matched as
// UTF-8 byte sequences.
const LeakPhrase kLeakPhrases[] = {
    {"current version", nullptr},
    {"next version", nullptr},
    {nullptr, "\xE5\xBD\x93\xE5\x89\x8D\xE7\x89\x88\xE6\x9C\xAC"},
    {nullptr, "\xE4\xB8\x8B\xE4\xB8\x80\xE4\xB8\xAA\xE7\x89\x88\xE6\x9C\xAC"},
};

struct VersionToken {
    std::size_t offset = 0;
    std::string text;
    std::string major;
    std::size_t segments = 0;
    bool has_fix = false;
};

std::vector<VersionToken> scan_version_tokens(std::string_view line) {
    std::vector<VersionToken> tokens;
    std::size_t position = 0;
    while (position < line.size()) {
        if (line[position] != 'v' || (position > 0 && is_ascii_word_byte(line[position - 1]))) {
            ++position;
            continue;
        }
        std::size_t cursor = position + 1;
        if (cursor >= line.size() || !is_ascii_digit(line[cursor])) {
            ++position;
            continue;
        }
        const std::size_t major_begin = cursor;
        while (cursor < line.size() && is_ascii_digit(line[cursor])) ++cursor;
        VersionToken token;
        token.offset = position;
        token.major = std::string(line.substr(major_begin, cursor - major_begin));
        bool has_fix = false;
        std::size_t parts = 0;
        bool advanced = true;
        while (advanced) {
            advanced = false;
            if (cursor < line.size() && line[cursor] == '.') {
                std::size_t digits = cursor + 1;
                while (digits < line.size() && is_ascii_digit(line[digits])) ++digits;
                if (digits > cursor + 1) {
                    ++parts;
                    cursor = digits;
                    advanced = true;
                    continue;
                }
            }
            if (!has_fix && cursor + 3 <= line.size() && line.compare(cursor, 3, "fix") == 0) {
                std::size_t digits = cursor + 3;
                while (digits < line.size() && is_ascii_digit(line[digits])) ++digits;
                if (digits > cursor + 3) {
                    has_fix = true;
                    cursor = digits;
                    advanced = true;
                }
            }
        }
        token.has_fix = has_fix;
        token.segments = parts + 1;
        token.text = std::string(line.substr(position, cursor - position));
        if (token.segments >= 3) tokens.push_back(std::move(token));
        position = cursor > position ? cursor : position + 1;
    }
    return tokens;
}

// True for a markdown table header row whose first two columns are Version and State,
// tolerating padding and further columns: `| Version | State |` and
// `| Version | State | Phase | ... |` both qualify.
bool is_version_table_header(std::string_view line) {
    const std::string text = trim(line);
    if (text.size() < 3 || text.front() != '|' || text.back() != '|') return false;
    const std::vector<std::string> cells = split(text.substr(1, text.size() - 2), '|');
    if (cells.size() < 2) return false;
    return to_lower_ascii(trim(cells[0])) == "version" &&
           to_lower_ascii(trim(cells[1])) == "state";
}

// Empty string means the token is a well-formed version identifier.
std::string version_problem(const VersionToken& token) {
    if (token.major != "0") {
        if (token.major.size() >= 2) return "major version must be a single 0";
        return "major version must be 0";
    }
    if (token.has_fix) {
        if (token.segments > 3) {
            return "a fourth numeric segment must not be combined with a fix suffix";
        }
        return {};
    }
    if (token.segments == 3 || token.segments == 4) return {};
    return "unsupported version form";
}

}  // namespace

void check_versions(const RepoTree& tree, ViolationSink& sink) {
    const std::string versions_path = "docs/plan/VERSIONS.md";
    if (const TextFile* file = tree.text(versions_path); file != nullptr) {
        for (std::size_t index = 0; index < file->lines.size(); ++index) {
            const std::string& line = file->lines[index];
            const int line_number = static_cast<int>(index + 1);
            for (const VersionToken& token : scan_version_tokens(line)) {
                const std::string problem = version_problem(token);
                if (problem.empty()) continue;
                sink.add_error(codes::VersionSyntax, versions_path, line_number,
                               "invalid version \"" + token.text + "\": " + problem);
            }
        }

        bool declared = false;
        for (const std::string& line : file->lines) {
            if (!is_version_table_header(line)) continue;
            declared = true;
            break;
        }
        if (!declared) {
            sink.add_warn(codes::LfOnlyDeclared, versions_path, 0,
                          "VERSIONS.md is missing the \"| Version | State |\" table header");
        }
    }

    for (const char* relative : kVersionAuthorityFiles) {
        const TextFile* file = tree.text(relative);
        if (file == nullptr) continue;
        const std::string path = relative;
        for (std::size_t index = 0; index < file->lines.size(); ++index) {
            const std::string& line = file->lines[index];
            for (const LeakPhrase& phrase : kLeakPhrases) {
                const bool hit = phrase.literal != nullptr
                                     ? line.find(phrase.literal) != std::string::npos
                                     : contains_case_insensitive(line, phrase.ascii);
                if (!hit) continue;
                sink.add_error(codes::VersionAuthorityLeak, path, static_cast<int>(index + 1),
                               std::string("version authority leak: ") +
                                   (phrase.literal != nullptr ? phrase.literal : phrase.ascii) +
                                   " must be replaced by a link to docs/plan/VERSIONS.md");
            }
        }
    }
}

}  // namespace docguard
