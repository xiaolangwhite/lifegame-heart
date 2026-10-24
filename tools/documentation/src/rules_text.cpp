// DOC_PATH_NOT_ENGLISH, DOC_CRLF, DOC_BOM: path and byte-level encoding rules.
#include <string>

#include "rules.hpp"
#include "strutil.hpp"
#include "text_file.hpp"

namespace docguard {
namespace {

std::string describe_crlf(const TextFile& file) {
    return "file contains CRLF line endings; " + std::to_string(file.crlf_count) +
           " occurrence(s), first on line " + std::to_string(file.first_crlf_line);
}

}  // namespace

void check_paths_and_encoding(const RepoTree& tree, ViolationSink& sink) {
    for (const TreeEntry& entry : tree.entries()) {
        if (!is_ascii_only(entry.path)) {
            sink.add_error(codes::PathNotEnglish, entry.path, 0,
                           std::string("relative path contains non-ASCII characters (") +
                               (entry.directory ? "directory" : "file") + ")");
        }
        if (entry.directory) continue;
        if (!has_tracked_text_extension(entry.path)) continue;

        const TextFile* file = tree.text(entry.path);
        if (file == nullptr) continue;

        if (file->has_bom) {
            sink.add_error(codes::Bom, entry.path, 1, "file starts with a UTF-8 byte order mark");
        }
        if (file->has_crlf) {
            sink.add_error(codes::Crlf, entry.path, static_cast<int>(file->first_crlf_line),
                           describe_crlf(*file));
        }
    }
}

}  // namespace docguard
