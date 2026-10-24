// Rendering of the two output formats. Both are deterministic for a given tree.
#pragma once

#include <cstddef>
#include <string>
#include <vector>

#include "model.hpp"

namespace docguard {

std::string render_text(const std::vector<Violation>& violations);

std::string render_json(const std::string& root_display, const std::vector<Violation>& violations);

std::string render_summary(const std::string& root_display, std::size_t errors, std::size_t warns,
                           std::size_t entries);

}  // namespace docguard
