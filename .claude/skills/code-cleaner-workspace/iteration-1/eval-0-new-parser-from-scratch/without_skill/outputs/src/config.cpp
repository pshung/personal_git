#include "config.hpp"

#include <istream>
#include <optional>
#include <string_view>
#include <utility>

namespace cfgtool {
namespace {

constexpr std::string_view kSpace = " \t\r\n\v\f";

// Drops leading and trailing whitespace. Returns an empty view for an
// all-whitespace input.
std::string_view trim(std::string_view text) {
    const std::size_t first = text.find_first_not_of(kSpace);
    if (first == std::string_view::npos) {
        return {};
    }
    return text.substr(first, text.find_last_not_of(kSpace) - first + 1);
}

// True when this first non-space character of a line opens a whole-line
// comment. Takes the character rather than the line so the caller's existing
// "is the line empty" test is not repeated here.
bool is_comment_marker(char first) {
    return first == '#' || first == ';';
}

// "[ name ]" -> "name". Returns nullopt when the header is malformed, i.e. it
// is not closed by ']' or the name is empty. 'text' is trimmed and starts
// with '['.
std::optional<std::string_view> parse_section_header(std::string_view text) {
    if (text.size() < 2 || text.back() != ']') {
        return std::nullopt;
    }
    const std::string_view name = trim(text.substr(1, text.size() - 2));
    if (name.empty()) {
        return std::nullopt;
    }
    return name;
}

// "key = value" -> ("key", "value"), splitting on the FIRST '=' so that the
// value may contain further '=' characters. Returns nullopt when there is no
// '=' at all or the key is empty. An empty value is valid. 'text' is trimmed
// and non-empty.
std::optional<std::pair<std::string_view, std::string_view>> split_key_value(std::string_view text) {
    const std::size_t eq = text.find('=');
    if (eq == std::string_view::npos) {
        return std::nullopt;
    }
    const std::string_view key = trim(text.substr(0, eq));
    if (key.empty()) {
        return std::nullopt;
    }
    return std::make_pair(key, trim(text.substr(eq + 1)));
}

}  // namespace

ConfigResult parse_config(std::istream& in) {
    ConfigResult result;
    std::string current_section;  // "" until the first header: the global section.
    std::string line;

    while (std::getline(in, line)) {
        const std::string_view text = trim(line);
        if (text.empty() || is_comment_marker(text.front())) {
            continue;
        }
        if (text.front() == '[') {
            if (const auto name = parse_section_header(text)) {
                current_section.assign(*name);
                result.sections.try_emplace(current_section);  // A header alone declares it.
            } else {
                ++result.bad_lines;
            }
            continue;
        }
        if (const auto entry = split_key_value(text)) {
            result.sections[current_section][std::string(entry->first)] = std::string(entry->second);
        } else {
            ++result.bad_lines;
        }
    }
    return result;
}

}  // namespace cfgtool
