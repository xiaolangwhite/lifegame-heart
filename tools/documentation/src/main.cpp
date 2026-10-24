// docguard entry point: parse the contract, run every check, render, return the verdict.
#include <iostream>
#include <string>
#include <vector>

#include "cli.hpp"
#include "model.hpp"
#include "repo_scan.hpp"
#include "report.hpp"
#include "rules.hpp"

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#endif

namespace {

#ifdef _WIN32
std::string wide_to_utf8(const std::wstring& value) {
    if (value.empty()) return {};
    const int size = ::WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                                           nullptr, 0, nullptr, nullptr);
    if (size <= 0) return {};
    std::string out(static_cast<std::size_t>(size), '\0');
    ::WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), out.data(), size,
                          nullptr, nullptr);
    return out;
}

void use_binary_standard_streams() {
    ::_setmode(::_fileno(stdout), _O_BINARY);
    ::_setmode(::_fileno(stderr), _O_BINARY);
}
#else
void use_binary_standard_streams() {}
#endif

int run(const std::vector<std::string>& arguments) {
    use_binary_standard_streams();

    const docguard::CliResult cli = docguard::parse_cli(arguments);
    if (!cli.ok) {
        std::cerr << "docguard: " << cli.error << "\n" << docguard::usage_text();
        return 2;
    }
    if (cli.options.help) {
        std::cout << docguard::usage_text();
        return 0;
    }

    std::string error;
    const std::optional<docguard::RepoTree> tree =
        docguard::RepoTree::build(cli.options.root, error);
    if (!tree.has_value()) {
        std::cerr << "docguard: " << error << "\n";
        return 2;
    }

    docguard::ViolationSink sink;
    docguard::run_all_checks(*tree, sink);
    sink.finalize();
    if (cli.options.strict) sink.promote_warnings();

    const std::size_t errors = sink.error_count();
    const std::size_t warns = sink.warn_count();
    const std::string summary =
        docguard::render_summary(tree->display_root(), errors, warns, tree->entries().size());

    if (cli.options.format == docguard::OutputFormat::Json) {
        std::cout << docguard::render_json(tree->display_root(), sink.violations());
        std::cerr << summary << "\n";
    } else if (cli.options.quiet) {
        std::cout << summary << "\n";
    } else {
        std::cout << docguard::render_text(sink.violations());
        std::cerr << summary << "\n";
    }

    if (!tree->io_failures().empty()) {
        for (const std::string& failure : tree->io_failures()) {
            std::cerr << "docguard: io error: " << failure << "\n";
        }
        return 2;
    }
    if (!sink.violations().empty()) return 1;
    return 0;
}

}  // namespace

#ifdef _WIN32
int wmain(int argc, wchar_t** argv) {
    std::vector<std::string> arguments;
    arguments.reserve(static_cast<std::size_t>(argc));
    for (int index = 0; index < argc; ++index) {
        arguments.push_back(wide_to_utf8(argv[index]));
    }
    return run(arguments);
}
#else
int main(int argc, char** argv) {
    const std::vector<std::string> arguments(argv, argv + argc);
    return run(arguments);
}
#endif
