#include "report.hpp"

#include <cstdio>

namespace docguard {
namespace {

void append_json_string(std::string& out, std::string_view text) {
    out.push_back('"');
    for (char value : text) {
        const unsigned char byte = static_cast<unsigned char>(value);
        switch (byte) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (byte < 0x20) {
                    char buffer[8];
                    std::snprintf(buffer, sizeof(buffer), "\\u%04x", byte);
                    out += buffer;
                } else {
                    out.push_back(value);
                }
                break;
        }
    }
    out.push_back('"');
}

}  // namespace

std::string render_text(const std::vector<Violation>& violations) {
    std::string out;
    for (const Violation& violation : violations) {
        out += severity_label(violation.severity);
        out.push_back(' ');
        out += violation.code;
        out.push_back(' ');
        out += violation.path;
        if (violation.line > 0) {
            out.push_back(':');
            out += std::to_string(violation.line);
        }
        out.push_back(' ');
        out += violation.message;
        out.push_back('\n');
    }
    return out;
}

std::string render_json(const std::string& root_display, const std::vector<Violation>& violations) {
    std::string out = "{\"root\":";
    append_json_string(out, root_display);
    out += ",\"violations\":[";
    for (std::size_t index = 0; index < violations.size(); ++index) {
        const Violation& violation = violations[index];
        if (index > 0) out.push_back(',');
        out += "{\"severity\":";
        append_json_string(out, severity_label(violation.severity));
        out += ",\"code\":";
        append_json_string(out, violation.code);
        out += ",\"path\":";
        append_json_string(out, violation.path);
        out += ",\"line\":";
        out += std::to_string(violation.line);
        out += ",\"message\":";
        append_json_string(out, violation.message);
        out.push_back('}');
    }
    out += "],\"counts\":{\"error\":";
    std::size_t errors = 0;
    std::size_t warns = 0;
    for (const Violation& violation : violations) {
        if (violation.severity == Severity::Error) {
            ++errors;
        } else {
            ++warns;
        }
    }
    out += std::to_string(errors);
    out += ",\"warn\":";
    out += std::to_string(warns);
    out += "}}\n";
    return out;
}

std::string render_summary(const std::string& root_display, std::size_t errors, std::size_t warns,
                           std::size_t entries) {
    return "docguard: " + std::to_string(errors) + " error(s), " + std::to_string(warns) +
           " warning(s), " + std::to_string(errors + warns) + " violation(s); scanned " +
           std::to_string(entries) + " entries under " + root_display;
}

}  // namespace docguard
