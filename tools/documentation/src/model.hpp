// Core data types shared by every docguard check.
#pragma once

#include <algorithm>
#include <cstddef>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace docguard {

enum class Severity { Warn, Error };

inline const char* severity_label(Severity severity) {
    return severity == Severity::Error ? "ERROR" : "WARN";
}

// One reported problem. `line` is 1-based; 0 means "not tied to a line".
struct Violation {
    Severity severity = Severity::Warn;
    std::string code;
    std::string path;
    int line = 0;
    std::string message;
};

// The check codes are part of the public contract and must never be renamed.
namespace codes {
inline constexpr std::string_view LayoutMissing = "DOC_LAYOUT_MISSING";
inline constexpr std::string_view PathNotEnglish = "DOC_PATH_NOT_ENGLISH";
inline constexpr std::string_view Crlf = "DOC_CRLF";
inline constexpr std::string_view Bom = "DOC_BOM";
inline constexpr std::string_view MarkdownLinkBroken = "DOC_MD_LINK_BROKEN";
inline constexpr std::string_view StatusVocabulary = "DOC_STATUS_VOCAB";
inline constexpr std::string_view Placeholder = "DOC_PLACEHOLDER";
inline constexpr std::string_view VersionSyntax = "DOC_VERSION_SYNTAX";
inline constexpr std::string_view VersionAuthorityLeak = "DOC_VERSION_AUTHORITY_LEAK";
inline constexpr std::string_view AdrNaming = "DOC_ADR_NAMING";
inline constexpr std::string_view AdrSections = "DOC_ADR_SECTIONS";
inline constexpr std::string_view ModuleContract = "DOC_MODULE_CONTRACT";
inline constexpr std::string_view ModuleCatalog = "DOC_MODULE_CATALOG";
inline constexpr std::string_view LfOnlyDeclared = "DOC_LF_ONLY_DECLARED";
inline constexpr std::string_view AbsolutePathInDocs = "DOC_ABSOLUTE_PATH_IN_DOCS";
}  // namespace codes

class ViolationSink {
public:
    void add(Severity severity, std::string_view code, std::string_view path, int line,
             std::string message) {
        violations_.push_back(Violation{severity, std::string(code), std::string(path), line,
                                        std::move(message)});
    }

    void add_error(std::string_view code, std::string_view path, int line, std::string message) {
        add(Severity::Error, code, path, line, std::move(message));
    }

    void add_warn(std::string_view code, std::string_view path, int line, std::string message) {
        add(Severity::Warn, code, path, line, std::move(message));
    }

    // Orders by (path, line, code, message) and removes exact duplicates, which makes the
    // rendering step byte-for-byte deterministic for a given tree.
    void finalize() {
        std::sort(violations_.begin(), violations_.end(),
                  [](const Violation& left, const Violation& right) {
                      if (left.path != right.path) return left.path < right.path;
                      if (left.line != right.line) return left.line < right.line;
                      if (left.code != right.code) return left.code < right.code;
                      return left.message < right.message;
                  });
        violations_.erase(std::unique(violations_.begin(), violations_.end(),
                                      [](const Violation& left, const Violation& right) {
                                          return left.severity == right.severity &&
                                                 left.code == right.code &&
                                                 left.path == right.path &&
                                                 left.line == right.line &&
                                                 left.message == right.message;
                                      }),
                          violations_.end());
    }

    // --strict: every warning is reported as an error.
    void promote_warnings() {
        for (Violation& violation : violations_) {
            if (violation.severity == Severity::Warn) violation.severity = Severity::Error;
        }
    }

    const std::vector<Violation>& violations() const { return violations_; }

    std::size_t error_count() const { return count(Severity::Error); }
    std::size_t warn_count() const { return count(Severity::Warn); }

private:
    std::size_t count(Severity severity) const {
        std::size_t total = 0;
        for (const Violation& violation : violations_) {
            if (violation.severity == severity) ++total;
        }
        return total;
    }

    std::vector<Violation> violations_;
};

}  // namespace docguard
