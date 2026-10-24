#include "cli.hpp"

#include "repo_scan.hpp"
#include "strutil.hpp"

namespace docguard {
namespace {

bool split_assignment(const std::string& argument, std::string_view name, std::string& value) {
    const std::string prefix = std::string(name) + "=";
    if (!starts_with(argument, prefix)) return false;
    value = argument.substr(prefix.size());
    return true;
}

}  // namespace

std::string usage_text() {
    return std::string(
        "usage: docguard [--root <dir>] [--format text|json] [--strict] [--quiet]\n"
        "\n"
        "  --root <dir>            tree to validate (default: the current working directory)\n"
        "  --format text|json      output format (default: text)\n"
        "  --strict                report warnings as errors\n"
        "  --quiet                 print only the summary line (text format)\n"
        "  -h, --help              print this message\n"
        "\n"
        "exit codes: 0 no violation; 1 violations found; 2 usage, IO or internal error\n");
}

CliResult parse_cli(const std::vector<std::string>& arguments) {
    CliResult result;
    result.options.root = std::filesystem::current_path();

    for (std::size_t index = 1; index < arguments.size(); ++index) {
        const std::string& argument = arguments[index];
        if (argument == "-h" || argument == "--help") {
            result.options.help = true;
            return result;
        }
        if (argument == "--strict") {
            result.options.strict = true;
            continue;
        }
        if (argument == "--quiet") {
            result.options.quiet = true;
            continue;
        }

        std::string value;
        if (argument == "--root" || argument == "--format") {
            if (index + 1 >= arguments.size()) {
                result.ok = false;
                result.error = "option " + argument + " requires a value";
                return result;
            }
            value = arguments[++index];
        } else if (split_assignment(argument, "--root", value) ||
                   split_assignment(argument, "--format", value)) {
            // value already filled in
        } else if (starts_with(argument, "-")) {
            result.ok = false;
            result.error = "unknown option: " + argument;
            return result;
        } else {
            result.ok = false;
            result.error = "unexpected positional argument: " + argument;
            return result;
        }

        if (starts_with(argument, "--root")) {
            if (value.empty()) {
                result.ok = false;
                result.error = "--root must not be empty";
                return result;
            }
            result.options.root = path_from_utf8(value);
            continue;
        }
        if (value == "text") {
            result.options.format = OutputFormat::Text;
        } else if (value == "json") {
            result.options.format = OutputFormat::Json;
        } else {
            result.ok = false;
            result.error = "unsupported --format value: " + value + " (expected text or json)";
            return result;
        }
    }
    return result;
}

}  // namespace docguard
