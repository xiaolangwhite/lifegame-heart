#include "json_value.hpp"

#include <cstddef>

#include "strutil.hpp"

namespace docguard {
namespace {

constexpr int kMaxDepth = 64;

void append_utf8(std::string& out, unsigned int code_point) {
    if (code_point <= 0x7F) {
        out.push_back(static_cast<char>(code_point));
    } else if (code_point <= 0x7FF) {
        out.push_back(static_cast<char>(0xC0 | (code_point >> 6)));
        out.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
    } else if (code_point <= 0xFFFF) {
        out.push_back(static_cast<char>(0xE0 | (code_point >> 12)));
        out.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
    } else {
        out.push_back(static_cast<char>(0xF0 | (code_point >> 18)));
        out.push_back(static_cast<char>(0x80 | ((code_point >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((code_point >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (code_point & 0x3F)));
    }
}

bool hex_value(char value, unsigned int& out) {
    if (value >= '0' && value <= '9') {
        out = static_cast<unsigned int>(value - '0');
        return true;
    }
    if (value >= 'a' && value <= 'f') {
        out = static_cast<unsigned int>(value - 'a' + 10);
        return true;
    }
    if (value >= 'A' && value <= 'F') {
        out = static_cast<unsigned int>(value - 'A' + 10);
        return true;
    }
    return false;
}

class Parser {
public:
    explicit Parser(std::string_view text) : text_(text) {}

    JsonParseResult run() {
        JsonParseResult result;
        skip_space();
        if (!parse_value(result.value, 0) || !error_.empty()) {
            result.ok = false;
            result.value = JsonValue{};
            result.error = error_.empty() ? std::string("invalid JSON") : error_;
            result.error_line = error_.empty() ? line_ : error_line_;
            return result;
        }
        skip_space();
        if (position_ < text_.size()) {
            fail("unexpected trailing content after the top-level value");
            result.ok = false;
            result.error = error_;
            result.error_line = error_line_;
            return result;
        }
        result.ok = true;
        result.value.line = result.value.line > 0 ? result.value.line : 1;
        return result;
    }

private:
    void fail(std::string message) {
        if (error_.empty()) {
            error_ = std::move(message);
            error_line_ = line_;
        }
    }

    void skip_space() {
        while (position_ < text_.size()) {
            const char value = text_[position_];
            if (value == '\n') {
                ++line_;
                ++position_;
                continue;
            }
            if (is_ascii_space(value)) {
                ++position_;
                continue;
            }
            break;
        }
    }

    bool parse_value(JsonValue& out, int depth) {
        if (depth > kMaxDepth) {
            fail("JSON nesting is too deep");
            return false;
        }
        skip_space();
        if (position_ >= text_.size()) {
            fail("unexpected end of input");
            return false;
        }
        out.line = line_;
        const char value = text_[position_];
        switch (value) {
            case '{':
                return parse_object(out, depth);
            case '[':
                return parse_array(out, depth);
            case '"':
                out.kind = JsonValue::Kind::String;
                return parse_string(out.text);
            case 't':
                return parse_literal("true", out, true);
            case 'f':
                return parse_literal("false", out, false);
            case 'n':
                return parse_literal("null", out, false);
            default:
                return parse_number(out);
        }
    }

    bool parse_literal(std::string_view literal, JsonValue& out, bool boolean) {
        if (text_.compare(position_, literal.size(), literal) != 0) {
            fail("invalid literal");
            return false;
        }
        position_ += literal.size();
        if (literal == "null") {
            out.kind = JsonValue::Kind::Null;
        } else {
            out.kind = JsonValue::Kind::Bool;
            out.boolean = boolean;
        }
        return true;
    }

    bool parse_number(JsonValue& out) {
        const std::size_t begin = position_;
        if (position_ < text_.size() && (text_[position_] == '-' || text_[position_] == '+')) {
            ++position_;
        }
        bool digits = false;
        while (position_ < text_.size() && is_ascii_digit(text_[position_])) {
            ++position_;
            digits = true;
        }
        if (position_ < text_.size() && text_[position_] == '.') {
            ++position_;
            while (position_ < text_.size() && is_ascii_digit(text_[position_])) {
                ++position_;
                digits = true;
            }
        }
        if (!digits) {
            fail("unexpected character where a value was expected");
            return false;
        }
        if (position_ < text_.size() && (text_[position_] == 'e' || text_[position_] == 'E')) {
            ++position_;
            if (position_ < text_.size() && (text_[position_] == '-' || text_[position_] == '+')) {
                ++position_;
            }
            while (position_ < text_.size() && is_ascii_digit(text_[position_])) ++position_;
        }
        out.kind = JsonValue::Kind::Number;
        out.number = std::strtod(std::string(text_.substr(begin, position_ - begin)).c_str(), nullptr);
        return true;
    }

    bool parse_string(std::string& out) {
        out.clear();
        ++position_;  // opening quote
        while (true) {
            if (position_ >= text_.size()) {
                fail("unterminated string");
                return false;
            }
            const char value = text_[position_];
            if (value == '"') {
                ++position_;
                return true;
            }
            if (value == '\n') {
                fail("unterminated string");
                return false;
            }
            if (value != '\\') {
                out.push_back(value);
                ++position_;
                continue;
            }
            ++position_;
            if (position_ >= text_.size()) {
                fail("unterminated escape sequence");
                return false;
            }
            const char escape = text_[position_++];
            switch (escape) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'b': out.push_back('\b'); break;
                case 'f': out.push_back('\f'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case 'u': {
                    unsigned int code_point = 0;
                    if (!parse_hex4(code_point)) return false;
                    if (code_point >= 0xD800 && code_point <= 0xDBFF && position_ + 1 < text_.size() &&
                        text_[position_] == '\\' && text_[position_ + 1] == 'u') {
                        position_ += 2;
                        unsigned int low = 0;
                        if (!parse_hex4(low)) return false;
                        if (low >= 0xDC00 && low <= 0xDFFF) {
                            code_point = 0x10000 + ((code_point - 0xD800) << 10) + (low - 0xDC00);
                        } else {
                            append_utf8(out, code_point);
                            code_point = low;
                        }
                    }
                    append_utf8(out, code_point);
                    break;
                }
                default:
                    fail("invalid escape sequence");
                    return false;
            }
        }
    }

    bool parse_hex4(unsigned int& out) {
        if (position_ + 4 > text_.size()) {
            fail("truncated unicode escape");
            return false;
        }
        unsigned int value = 0;
        for (int index = 0; index < 4; ++index) {
            unsigned int digit = 0;
            if (!hex_value(text_[position_ + static_cast<std::size_t>(index)], digit)) {
                fail("invalid unicode escape");
                return false;
            }
            value = (value << 4) | digit;
        }
        position_ += 4;
        out = value;
        return true;
    }

    bool parse_array(JsonValue& out, int depth) {
        out.kind = JsonValue::Kind::Array;
        out.line = line_;
        ++position_;  // '['
        skip_space();
        if (position_ < text_.size() && text_[position_] == ']') {
            ++position_;
            return true;
        }
        while (true) {
            JsonValue item;
            if (!parse_value(item, depth + 1)) return false;
            out.items.push_back(std::move(item));
            skip_space();
            if (position_ >= text_.size()) {
                fail("unterminated array");
                return false;
            }
            if (text_[position_] == ',') {
                ++position_;
                continue;
            }
            if (text_[position_] == ']') {
                ++position_;
                return true;
            }
            fail("expected ',' or ']' in array");
            return false;
        }
    }

    bool parse_object(JsonValue& out, int depth) {
        out.kind = JsonValue::Kind::Object;
        out.line = line_;
        ++position_;  // '{'
        skip_space();
        if (position_ < text_.size() && text_[position_] == '}') {
            ++position_;
            return true;
        }
        while (true) {
            skip_space();
            if (position_ >= text_.size() || text_[position_] != '"') {
                fail("expected a quoted object key");
                return false;
            }
            std::string key;
            const int key_line = line_;
            if (!parse_string(key)) return false;
            skip_space();
            if (position_ >= text_.size() || text_[position_] != ':') {
                fail("expected ':' after an object key");
                return false;
            }
            ++position_;
            JsonValue value;
            if (!parse_value(value, depth + 1)) return false;
            value.line = value.line > 0 ? value.line : key_line;
            out.members.emplace_back(std::move(key), std::move(value));
            skip_space();
            if (position_ >= text_.size()) {
                fail("unterminated object");
                return false;
            }
            if (text_[position_] == ',') {
                ++position_;
                continue;
            }
            if (text_[position_] == '}') {
                ++position_;
                return true;
            }
            fail("expected ',' or '}' in object");
            return false;
        }
    }

    std::string_view text_;
    std::size_t position_ = 0;
    int line_ = 1;
    std::string error_;
    int error_line_ = 1;
};

}  // namespace

const JsonValue* JsonValue::member(std::string_view key) const {
    for (const auto& entry : members) {
        if (entry.first == key) return &entry.second;
    }
    return nullptr;
}

JsonParseResult parse_json(std::string_view text) {
    Parser parser(text);
    return parser.run();
}

}  // namespace docguard
