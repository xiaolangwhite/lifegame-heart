// Check entry points. Each rule lives in its own translation unit.
#pragma once

#include "model.hpp"
#include "repo_scan.hpp"

namespace docguard {

void check_layout(const RepoTree& tree, ViolationSink& sink);
void check_paths_and_encoding(const RepoTree& tree, ViolationSink& sink);
void check_markdown(const RepoTree& tree, ViolationSink& sink);
void check_versions(const RepoTree& tree, ViolationSink& sink);
void check_adr(const RepoTree& tree, ViolationSink& sink);
void check_modules(const RepoTree& tree, ViolationSink& sink);

void run_all_checks(const RepoTree& tree, ViolationSink& sink);

// Shared helpers used by more than one rule.
bool is_docs_markdown(const std::string& relative);
bool is_markdown(const std::string& relative);
std::vector<std::string> module_directories(const RepoTree& tree);

}  // namespace docguard
