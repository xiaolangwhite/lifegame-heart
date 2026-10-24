// ADR rules: directory/file naming (DOC_ADR_NAMING) and required sections (DOC_ADR_SECTIONS).
#include <algorithm>
#include <iterator>
#include <map>
#include <string>
#include <vector>

#include "rules.hpp"
#include "strutil.hpp"
#include "text_file.hpp"

namespace docguard {
namespace {

const char* const kCategories[] = {
    "governance-and-build",
    "simulation-core",
    "service-and-api",
    "ui-and-visualization",
    "data-and-formats",
};

const char* const kSections[] = {"status", "context", "decision", "consequences"};

bool is_category(std::string_view name) {
    for (const char* candidate : kCategories) {
        if (name == candidate) return true;
    }
    return false;
}

bool is_kebab_segment(std::string_view text) {
    if (text.empty()) return false;
    for (char value : text) {
        const bool allowed = (value >= 'a' && value <= 'z') || (value >= '0' && value <= '9') ||
                             value == '-';
        if (!allowed) return false;
    }
    return true;
}

// `NNNN-kebab-title.md`
bool is_adr_file_name(std::string_view name, std::string& number, std::string& problem) {
    number.clear();
    problem.clear();
    if (!ends_with(name, ".md")) {
        problem = "ADR file name must end in .md";
        return false;
    }
    const std::string_view stem = name.substr(0, name.size() - 3);
    if (stem.size() < 5) {
        problem = "ADR file name must start with four digits and a kebab-case title";
        return false;
    }
    for (std::size_t index = 0; index < 4; ++index) {
        if (is_ascii_digit(stem[index])) continue;
        problem = "ADR file name must start with four digits";
        return false;
    }
    if (stem[4] != '-') {
        problem = "the ADR number must be followed by '-' and a kebab-case title";
        return false;
    }
    const std::string_view title = stem.substr(5);
    if (title.empty()) {
        problem = "ADR file name must carry a kebab-case title";
        return false;
    }
    for (const std::string& segment : split(title, '-')) {
        if (is_kebab_segment(segment)) continue;
        problem = "ADR title must be kebab-case (lowercase letters, digits, '-' only)";
        return false;
    }
    number = std::string(stem.substr(0, 4));
    return true;
}

bool is_readme_exception(const std::string& relative) {
    if (relative == "docs/adr/README.md") return true;
    if (!ends_with(relative, "README.md")) return false;
    return relative.size() > std::string("docs/adr/README.md").size();
}

bool is_adr_heading(std::string_view trimmed, std::string_view keyword) {
    if (!starts_with(trimmed, "##")) return false;
    std::size_t cursor = 0;
    while (cursor < trimmed.size() && trimmed[cursor] == '#') ++cursor;
    if (cursor < 2) return false;
    while (cursor < trimmed.size() && is_ascii_space(trimmed[cursor])) ++cursor;
    const std::string_view heading = trimmed.substr(cursor);
    if (heading.size() < keyword.size()) return false;
    if (to_lower_ascii(heading.substr(0, keyword.size())) != keyword) return false;
    if (heading.size() > keyword.size() && is_ascii_word_byte(heading[keyword.size()])) return false;
    return true;
}

bool has_title_line(const TextFile& file) {
    FenceTracker fence;
    for (const std::string& line : file.lines) {
        fence.feed(line);
        if (fence.inside()) continue;
        const std::string_view trimmed = trim_view(line);
        if (trimmed.empty() || trimmed[0] != '#') continue;
        std::size_t cursor = 0;
        while (cursor < trimmed.size() && trimmed[cursor] == '#') ++cursor;
        if (cursor != 1) continue;
        while (cursor < trimmed.size() && is_ascii_space(trimmed[cursor])) ++cursor;
        const std::string_view rest = trimmed.substr(cursor);
        if (rest.size() < 4) continue;
        if (to_lower_ascii(rest.substr(0, 3)) != "adr") continue;
        if (!is_ascii_space(rest[3])) continue;
        std::size_t digits = 4;
        while (digits < rest.size() && is_ascii_space(rest[digits])) ++digits;
        if (digits + 4 > rest.size()) continue;
        bool numeric = true;
        for (std::size_t index = 0; index < 4; ++index) {
            if (is_ascii_digit(rest[digits + index])) continue;
            numeric = false;
            break;
        }
        if (!numeric) continue;
        const std::size_t after = digits + 4;
        if (after < rest.size() && is_ascii_word_byte(rest[after])) continue;
        return true;
    }
    return false;
}

std::vector<bool> section_presence(const TextFile& file) {
    std::vector<bool> present(std::size(kSections), false);
    FenceTracker fence;
    for (const std::string& line : file.lines) {
        fence.feed(line);
        if (fence.inside()) continue;
        const std::string_view trimmed = trim_view(line);
        for (std::size_t index = 0; index < std::size(kSections); ++index) {
            if (present[index]) continue;
            if (is_adr_heading(trimmed, kSections[index])) present[index] = true;
        }
    }
    return present;
}

}  // namespace

void check_adr(const RepoTree& tree, ViolationSink& sink) {
    std::vector<std::string> adr_files;
    std::vector<std::string> category_directories;

    for (const TreeEntry& entry : tree.entries()) {
        if (!starts_with(entry.path, "docs/adr/")) continue;
        const std::vector<std::string> parts = split(entry.path, '/');
        if (entry.directory) {
            if (parts.size() == 3) category_directories.push_back(parts[2]);
            continue;
        }
        if (is_markdown(entry.path) && !is_readme_exception(entry.path)) {
            adr_files.push_back(entry.path);
        }
    }

    for (const std::string& directory : category_directories) {
        if (is_category(directory)) continue;
        sink.add_error(codes::AdrNaming, "docs/adr/" + directory, 0,
                       "unknown ADR category directory \"" + directory + "\"");
    }

    std::map<std::string, std::vector<std::string>> by_number;
    for (const std::string& relative : adr_files) {
        const std::string rest = relative.substr(std::string("docs/adr/").size());
        const std::vector<std::string> parts = split(rest, '/');
        const std::string name = parts.back();
        if (parts.size() == 1) {
            sink.add_error(codes::AdrNaming, relative, 0,
                           "ADR file must live directly inside a category directory");
        } else if (parts.size() > 2) {
            sink.add_error(codes::AdrNaming, relative, 0,
                           "ADR file must live directly inside a category directory");
        } else if (!is_category(parts[0])) {
            sink.add_error(codes::AdrNaming, relative, 0,
                           "unknown ADR category directory \"" + parts[0] + "\"");
        }

        std::string number;
        std::string problem;
        if (is_adr_file_name(name, number, problem)) {
            by_number[number].push_back(relative);
        } else {
            sink.add_error(codes::AdrNaming, relative, 0, problem);
        }
    }

    for (const auto& group : by_number) {
        if (group.second.size() < 2) continue;
        for (const std::string& relative : group.second) {
            std::string others;
            for (const std::string& other : group.second) {
                if (other == relative) continue;
                if (!others.empty()) others += ", ";
                others += other;
            }
            sink.add_error(codes::AdrNaming, relative, 0,
                           "ADR number " + group.first + " is not unique (also used by " + others +
                               ")");
        }
    }

    for (const std::string& relative : adr_files) {
        const TextFile* file = tree.text(relative);
        if (file == nullptr) continue;
        if (!has_title_line(*file)) {
            sink.add_error(codes::AdrSections, relative, 0,
                           "ADR is missing the \"# ADR NNNN\" title line");
        }
        const std::vector<bool> present = section_presence(*file);
        for (std::size_t index = 0; index < std::size(kSections); ++index) {
            if (present[index]) continue;
            sink.add_error(codes::AdrSections, relative, 0,
                           std::string("ADR is missing the required section \"") +
                               kSections[index] + "\"");
        }
    }
}

}  // namespace docguard
