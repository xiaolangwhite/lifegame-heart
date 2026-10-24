// Command line contract: docguard [--root <dir>] [--format text|json] [--strict] [--quiet]
#pragma once

#include <filesystem>
#include <string>
#include <vector>

namespace docguard {

enum class OutputFormat { Text, Json };

struct CliOptions {
    std::filesystem::path root;
    OutputFormat format = OutputFormat::Text;
    bool strict = false;
    bool quiet = false;
    bool help = false;
};

struct CliResult {
    bool ok = true;
    CliOptions options;
    std::string error;
};

CliResult parse_cli(const std::vector<std::string>& arguments);

std::string usage_text();

}  // namespace docguard
