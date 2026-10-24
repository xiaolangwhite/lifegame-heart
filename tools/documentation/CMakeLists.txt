cmake_minimum_required(VERSION 3.20)
project(docguard LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

add_executable(docguard
  src/main.cpp
  src/cli.cpp
  src/report.cpp
  src/repo_scan.cpp
  src/text_file.cpp
  src/json_value.cpp
  src/strutil.cpp
  src/rules_common.cpp
  src/rules_layout.cpp
  src/rules_text.cpp
  src/rules_markdown.cpp
  src/rules_version.cpp
  src/rules_adr.cpp
  src/rules_module.cpp
)

target_include_directories(docguard PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src")

if(MSVC)
  target_compile_options(docguard PRIVATE /W4 /utf-8 /EHsc)
else()
  target_compile_options(docguard PRIVATE -Wall -Wextra -Wpedantic)
  if(MINGW)
    # A self-contained executable: no MinGW runtime DLLs are required to run it.
    target_link_options(docguard PRIVATE -static -static-libgcc -static-libstdc++ -municode)
  endif()
endif()

set_target_properties(docguard PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
)
