// cfgtool -- INI-style configuration parser.
#ifndef CFGTOOL_CONFIG_HPP
#define CFGTOOL_CONFIG_HPP

#include <cstddef>
#include <iosfwd>
#include <map>
#include <optional>
#include <string>
#include <string_view>

namespace cfgtool {

// Keys of one [section], sorted by key name. On a duplicate key the last one wins.
using Section = std::map<std::string, std::string>;

struct Config {
    // Section name -> its keys. Keys that appear before the first [section]
    // header land in the section named "" (the global section); that section
    // exists only if such a key was actually seen.
    std::map<std::string, Section> sections;

    // Lines that were none of blank / comment / header / key=value. They are
    // skipped; the count is kept so the CLI can warn about them.
    std::size_t bad_lines = 0;
};

// Parse an INI-style stream. Never throws on content: an unparsable line is
// skipped and counted in Config::bad_lines.
//
// Grammar, applied per line after trimming both ends:
//   ""                 ignored (blank line)
//   starts '#' or ';'  ignored (whole-line comments only, so a *value* may
//                      contain '#' and ';')
//   "[name]"           section header; name is trimmed and must be non-empty
//   "key=value"        split at the FIRST '=' only, so a value may contain '=';
//                      both sides are trimmed; key must be non-empty
//   anything else      malformed -> skipped, ++bad_lines
Config parse_config(std::istream& in);

// Line-level pieces. Public so they can be tested directly; not the stable API.
// Each returns views INTO its argument, so the caller's buffer must outlive them.
namespace detail {

struct KeyValue {
    std::string_view key;
    std::string_view value;
};

// Drop leading/trailing whitespace (" \t\r\n\v\f"), which also removes the '\r'
// std::getline leaves behind on a CRLF file.
std::string_view trim(std::string_view s);

// True when an already-trimmed line starts with '#' or ';'.
bool is_comment(std::string_view trimmed);

// "[name]" -> the trimmed, non-empty name; nullopt if not a well-formed header.
std::optional<std::string_view> parse_section_header(std::string_view trimmed);

// "key=value" -> both sides trimmed; nullopt if there is no '=' or the key is
// empty. An empty value is legal.
std::optional<KeyValue> parse_key_value(std::string_view trimmed);

// Fold one raw line into cfg / current_section. Returns false if the line is
// malformed (caller counts it).
bool apply_line(std::string_view line, Config& cfg, std::string& current_section);

}  // namespace detail
}  // namespace cfgtool

#endif  // CFGTOOL_CONFIG_HPP
