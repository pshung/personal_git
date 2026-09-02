#include "config.hpp"

#include <istream>

namespace cfgtool {
namespace detail {
namespace {
constexpr std::string_view kWhitespace = " \t\r\n\v\f";
}  // namespace

std::string_view trim(std::string_view s) {
    const std::size_t first = s.find_first_not_of(kWhitespace);
    if (first == std::string_view::npos) return {};
    return s.substr(first, s.find_last_not_of(kWhitespace) - first + 1);
}

bool is_comment(std::string_view trimmed) {
    return !trimmed.empty() && (trimmed.front() == '#' || trimmed.front() == ';');
}

std::optional<std::string_view> parse_section_header(std::string_view trimmed) {
    if (trimmed.size() < 2 || trimmed.front() != '[' || trimmed.back() != ']') {
        return std::nullopt;
    }
    const std::string_view name = trim(trimmed.substr(1, trimmed.size() - 2));
    if (name.empty()) return std::nullopt;
    return name;
}

std::optional<KeyValue> parse_key_value(std::string_view trimmed) {
    const std::size_t eq = trimmed.find('=');
    if (eq == std::string_view::npos) return std::nullopt;
    const std::string_view key = trim(trimmed.substr(0, eq));
    if (key.empty()) return std::nullopt;
    return KeyValue{key, trim(trimmed.substr(eq + 1))};
}

bool apply_line(std::string_view line, Config& cfg, std::string& current_section) {
    const std::string_view text = trim(line);
    if (text.empty() || is_comment(text)) return true;
    if (const auto name = parse_section_header(text)) {
        current_section.assign(*name);
        cfg.sections[current_section];  // a section with no keys is still a section
        return true;
    }
    if (const auto kv = parse_key_value(text)) {
        cfg.sections[current_section][std::string(kv->key)] = std::string(kv->value);
        return true;
    }
    return false;
}

}  // namespace detail

Config parse_config(std::istream& in) {
    Config cfg;
    std::string current_section;  // "" until the first [section] header
    std::string line;
    while (std::getline(in, line)) {
        if (!detail::apply_line(line, cfg, current_section)) ++cfg.bad_lines;
    }
    return cfg;
}

}  // namespace cfgtool
