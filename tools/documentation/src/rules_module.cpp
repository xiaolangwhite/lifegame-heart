// Module documentation rules: the eight required files and the module catalog.
#include <algorithm>
#include <string>
#include <vector>

#include "json_value.hpp"
#include "rules.hpp"
#include "strutil.hpp"
#include "text_file.hpp"

namespace docguard {
namespace {

const char* const kModuleFiles[] = {
    "overview.md",     "responsibilities.md", "interfaces.md", "data-flow.md",
    "implementation.md", "performance.md",     "testing.md",    "risks.md",
};

bool is_catalog_module_name(std::string_view name) {
    if (name.empty()) return false;
    if (name[0] < 'a' || name[0] > 'z') return false;
    for (char value : name) {
        const bool allowed = (value >= 'a' && value <= 'z') || (value >= '0' && value <= '9') ||
                             value == '-';
        if (!allowed) return false;
    }
    return true;
}

}  // namespace

void check_modules(const RepoTree& tree, ViolationSink& sink) {
    const std::vector<std::string> modules = module_directories(tree);

    for (const std::string& name : modules) {
        for (const char* required : kModuleFiles) {
            const std::string relative = "docs/model/" + name + "/" + required;
            if (tree.is_regular_file(relative)) continue;
            sink.add_error(codes::ModuleContract, relative, 0,
                           "required module document is missing");
        }
    }

    const std::string catalog_path = "docs/model/module-catalog.json";
    const TextFile* catalog = tree.text(catalog_path);
    if (catalog == nullptr) return;

    const JsonParseResult parsed = parse_json(catalog->bytes);
    if (!parsed.ok) {
        sink.add_error(codes::ModuleCatalog, catalog_path, parsed.error_line,
                       "module catalog is not valid JSON: " + parsed.error);
        return;
    }
    const JsonValue* modules_value = parsed.value.member("modules");
    if (modules_value == nullptr || !modules_value->is_array()) {
        sink.add_error(codes::ModuleCatalog, catalog_path, parsed.value.line,
                       "module catalog must contain a \"modules\" array");
        return;
    }

    std::vector<std::string> listed;
    for (const JsonValue& item : modules_value->items) {
        if (!item.is_object()) {
            sink.add_error(codes::ModuleCatalog, catalog_path, item.line,
                           "every module catalog entry must be an object");
            continue;
        }
        const JsonValue* name = item.member("name");
        if (name == nullptr || !name->is_string()) {
            sink.add_error(codes::ModuleCatalog, catalog_path, item.line,
                           "every module catalog entry must carry a string \"name\"");
            continue;
        }
        listed.push_back(name->text);
        const int line = name->line;
        if (!is_catalog_module_name(name->text)) {
            sink.add_error(codes::ModuleCatalog, catalog_path, line,
                           "module name \"" + name->text + "\" must match ^[a-z][a-z0-9-]*$");
        }
        if (!tree.is_directory("docs/model/" + name->text)) {
            sink.add_error(codes::ModuleCatalog, catalog_path, line,
                           "module catalog lists \"" + name->text + "\" but docs/model/" +
                               name->text + " does not exist");
        }
    }

    for (const std::string& name : modules) {
        if (std::find(listed.begin(), listed.end(), name) != listed.end()) continue;
        sink.add_error(codes::ModuleCatalog, catalog_path, 0,
                       "module directory \"" + name + "\" is not listed in " + catalog_path);
    }
}

}  // namespace docguard
