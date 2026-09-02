#ifndef CFGTOOL_CONFIG_HPP
#define CFGTOOL_CONFIG_HPP

#include <cstddef>
#include <iosfwd>
#include <map>
#include <string>

namespace cfgtool {

// Key -> value for one section. Keys are unique; a repeated key keeps the last
// value seen in the file.
using ConfigSection = std::map<std::string, std::string>;

struct ConfigResult {
    // Section name -> its entries. Keys that appear before the first [section]
    // header are stored under the empty section name "".
    std::map<std::string, ConfigSection> sections;

    // Number of lines that were neither blank, comment, section header nor a
    // valid key=value pair. Such lines are skipped; the caller (the CLI) is
    // expected to warn when this is non-zero.
    std::size_t bad_lines = 0;
};

// Parses an INI-style stream. The grammar, one line at a time:
//
//   <blank>          a line that is empty after trimming            -> ignored
//   # ... / ; ...    first non-space character is '#' or ';'        -> ignored
//   [name]           section header; 'name' is trimmed, non-empty   -> switches section
//   key = value      split on the FIRST '='; both sides trimmed     -> stored
//   anything else                                                   -> ++bad_lines
//
// Notes on the deliberate choices:
//  * Only whole-line comments are recognised. '#' and ';' inside a value are
//    ordinary characters, the same way '=' inside a value is.
//  * A value may be empty ("key ="); a key may not ("= value" is malformed).
//  * A malformed header does not change the current section.
//  * A header with no keys under it still declares an (empty) section.
//  * Trailing '\r' is whitespace, so CRLF files parse the same as LF files.
//
// Malformed input is never fatal and never rejected by an exception: bad lines
// are counted and skipped, and parsing continues with the next line.
ConfigResult parse_config(std::istream& in);

}  // namespace cfgtool

#endif  // CFGTOOL_CONFIG_HPP
