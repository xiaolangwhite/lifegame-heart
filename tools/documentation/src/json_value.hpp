// Minimal dependency-free JSON reader with line tracking.
#pragma once

#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace docguard {

struct JsonValue {
    enum class Kind { Null, Bool, Number, String, Array, Object };

    Kind kind = Kind::Null;
    bool boolean = false;
    double number = 0.0;
    std::string text;
    std::vector<JsonValue> items;
    std::vector<std::pair<std::string, JsonValue>> members;
    int line = 1;  // 1-based line where this value starts

    bool is_object() const { return kind == Kind::Object; }
    bool is_array() const { return kind == Kind::Array; }
    bool is_string() const { return kind == Kind::String; }

    // First member with the given key, or nullptr.
    const JsonValue* member(std::string_view key) const;
};

struct JsonParseResult {
    bool ok = false;
    JsonValue value;
    std::string error;
    int error_line = 1;
};

JsonParseResult parse_json(std::string_view text);

}  // namespace docguard
