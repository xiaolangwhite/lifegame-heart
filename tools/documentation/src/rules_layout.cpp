// DOC_LAYOUT_MISSING: the paths the documentation contract declares as mandatory.
#include "rules.hpp"

namespace docguard {
namespace {

struct RequiredPath {
    const char* path;
    bool directory;
};

constexpr RequiredPath kRequiredPaths[] = {
    {"AGENTS.md", false},
    {"ENGINE_STANDARD.md", false},
    {"README.md", false},
    {"docs/AI_DOCUMENTATION_GUIDE.md", false},
    {"docs/DOCUMENTATION_RULES.md", false},
    {"docs/MODULE_COMPONENT_GUIDE.md", false},
    {"docs/README.md", false},
    {"docs/adr/README.md", false},
    {"docs/model/module-catalog.json", false},
    {"docs/plan/PERFORMANCE_ACCEPTANCE.md", false},
    {"docs/plan/ROADMAP.md", false},
    {"docs/plan/VERSIONS.md", false},
    {"dev-log", true},
    {"evidence", true},
};

}  // namespace

void check_layout(const RepoTree& tree, ViolationSink& sink) {
    for (const RequiredPath& required : kRequiredPaths) {
        const std::string path = required.path;
        if (required.directory) {
            if (tree.is_directory(path)) continue;
            if (tree.exists(path)) {
                sink.add_error(codes::LayoutMissing, path, 0,
                               "required path exists but is not a directory");
            } else {
                sink.add_error(codes::LayoutMissing, path, 0, "required directory is missing");
            }
            continue;
        }
        if (tree.is_regular_file(path)) continue;
        if (tree.exists(path)) {
            sink.add_error(codes::LayoutMissing, path, 0,
                           "required path exists but is not a regular file");
        } else {
            sink.add_error(codes::LayoutMissing, path, 0, "required file is missing");
        }
    }
}

}  // namespace docguard
