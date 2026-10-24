#include <algorithm>

#include "rules.hpp"
#include "strutil.hpp"

namespace docguard {

bool is_markdown(const std::string& relative) { return ends_with(relative, ".md"); }

bool is_docs_markdown(const std::string& relative) {
    return starts_with(relative, "docs/") && is_markdown(relative);
}

std::vector<std::string> module_directories(const RepoTree& tree) {
    std::vector<std::string> modules;
    for (const TreeEntry& entry : tree.entries()) {
        if (!entry.directory) continue;
        const std::vector<std::string> parts = split(entry.path, '/');
        if (parts.size() != 3) continue;
        if (parts[0] != "docs" || parts[1] != "model") continue;
        const std::string& name = parts[2];
        if (name.empty() || name[0] == '.') continue;
        if (tree.exists("docs/model/" + name + "/README.md")) continue;
        modules.push_back(name);
    }
    std::sort(modules.begin(), modules.end());
    modules.erase(std::unique(modules.begin(), modules.end()), modules.end());
    return modules;
}

void run_all_checks(const RepoTree& tree, ViolationSink& sink) {
    check_layout(tree, sink);
    check_paths_and_encoding(tree, sink);
    check_markdown(tree, sink);
    check_versions(tree, sink);
    check_adr(tree, sink);
    check_modules(tree, sink);
}

}  // namespace docguard
