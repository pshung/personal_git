// Plain-assert tests for the cfgtool INI parser. No framework; ctest runs the
// binary and a failing assert aborts it.
#undef NDEBUG  // asserts must survive whatever build type CMake picked
#include <cassert>

#include <cstdio>
#include <sstream>
#include <string>

#include "config.hpp"

using cfgtool::Config;
using cfgtool::parse_config;
namespace detail = cfgtool::detail;

namespace {

Config parse(const std::string& text) {
    std::istringstream in(text);
    return parse_config(in);
}

// Aborts (via assert) if the section or key is missing, so every caller can
// compare the value directly.
const std::string& value_of(const Config& cfg, const std::string& section,
                            const std::string& key) {
    const auto s = cfg.sections.find(section);
    assert(s != cfg.sections.end());
    const auto k = s->second.find(key);
    assert(k != s->second.end());
    return k->second;
}

// ---------------------------------------------------------------- detail::trim

void trim_strips_whitespace_at_both_ends() {
    assert(detail::trim("  a b  ") == "a b");
    assert(detail::trim("nospace") == "nospace");
    assert(detail::trim("\t x \r\n") == "x");
}

void trim_of_blank_input_is_empty() {
    assert(detail::trim("").empty());
    assert(detail::trim("  \t\r\n ").empty());
}

// ---------------------------------------------------------- detail::is_comment

void is_comment_accepts_hash_and_semicolon() {
    assert(detail::is_comment("# note"));
    assert(detail::is_comment(";note"));
}

void is_comment_rejects_content_and_empty_lines() {
    assert(!detail::is_comment("key=1"));
    assert(!detail::is_comment(""));
}

// ------------------------------------------------- detail::parse_section_header

void section_header_yields_the_trimmed_name() {
    assert(detail::parse_section_header("[main]") == "main");
    assert(detail::parse_section_header("[  main sub  ]") == "main sub");
}

void section_header_rejects_malformed_lines() {
    assert(!detail::parse_section_header("[main"));    // no closing bracket
    assert(!detail::parse_section_header("main]"));    // no opening bracket
    assert(!detail::parse_section_header("["));        // shorter than "[]"
    assert(!detail::parse_section_header("[]"));       // empty name
    assert(!detail::parse_section_header("[   ]"));    // whitespace-only name
    assert(!detail::parse_section_header("plain"));    // not a header at all
    assert(!detail::parse_section_header("[a] junk")); // trailing junk
}

// ---------------------------------------------------- detail::parse_key_value

void key_value_splits_on_the_first_equals_only() {
    const auto kv = detail::parse_key_value("url = http://x/?a=1&b=2");
    assert(kv);
    assert(kv->key == "url");
    assert(kv->value == "http://x/?a=1&b=2");
}

void key_value_trims_both_sides() {
    const auto kv = detail::parse_key_value("  name  =   Ada Lovelace  ");
    assert(kv);
    assert(kv->key == "name");
    assert(kv->value == "Ada Lovelace");
}

void key_value_allows_an_empty_value() {
    const auto kv = detail::parse_key_value("name =   ");
    assert(kv);
    assert(kv->key == "name");
    assert(kv->value.empty());
}

void key_value_rejects_missing_equals_or_empty_key() {
    assert(!detail::parse_key_value("just some words"));
    assert(!detail::parse_key_value("=orphan"));
    assert(!detail::parse_key_value("   = orphan"));
}

// ------------------------------------------------------------- parse_config

void parse_config_reads_sections_keys_comments_and_blanks() {
    const Config cfg = parse(
        "# leading comment\n"
        "; another comment\n"
        "\n"
        "[server]\n"
        "  host = localhost  \n"
        "port=8080\n"
        "\n"
        "   [client]   \n"
        "retries = 3\n");
    assert(cfg.bad_lines == 0);
    assert(cfg.sections.size() == 2);
    assert(value_of(cfg, "server", "host") == "localhost");
    assert(value_of(cfg, "server", "port") == "8080");
    assert(value_of(cfg, "client", "retries") == "3");
}

void parse_config_counts_malformed_lines_and_keeps_going() {
    const Config cfg = parse(
        "[a]\n"
        "good=1\n"
        "this line has no equals sign\n"
        "[unterminated\n"
        "=empty key\n"
        "still=here\n");
    assert(cfg.bad_lines == 3);
    assert(value_of(cfg, "a", "good") == "1");
    assert(value_of(cfg, "a", "still") == "here");
    assert(cfg.sections.at("a").size() == 2);
}

void parse_config_puts_keys_before_any_header_in_the_global_section() {
    const Config cfg = parse("mode=fast\n[x]\nk=v\n");
    assert(value_of(cfg, "", "mode") == "fast");
    assert(value_of(cfg, "x", "k") == "v");
}

void parse_config_keeps_the_last_of_duplicate_keys() {
    const Config cfg = parse("[a]\nk=1\nk=2\n");
    assert(value_of(cfg, "a", "k") == "2");
    assert(cfg.sections.at("a").size() == 1);
}

void parse_config_keeps_a_section_that_has_no_keys() {
    const Config cfg = parse("[empty]\n[b]\nk=v\n");
    assert(cfg.sections.count("empty") == 1);
    assert(cfg.sections.at("empty").empty());
}

void parse_config_treats_comment_markers_inside_a_value_as_data() {
    const Config cfg = parse("[b]\nmsg = a # b ; c\n");
    assert(cfg.bad_lines == 0);
    assert(value_of(cfg, "b", "msg") == "a # b ; c");
}

void parse_config_strips_crlf_line_endings() {
    const Config cfg = parse("[a]\r\nk = v\r\n");
    assert(cfg.bad_lines == 0);
    assert(value_of(cfg, "a", "k") == "v");
}

void parse_config_on_empty_input_yields_nothing() {
    const Config cfg = parse("");
    assert(cfg.sections.empty());
    assert(cfg.bad_lines == 0);
}

void parse_config_accepts_a_last_line_without_a_newline() {
    const Config cfg = parse("[a]\nk=v");
    assert(cfg.bad_lines == 0);
    assert(value_of(cfg, "a", "k") == "v");
}

}  // namespace

int main() {
    trim_strips_whitespace_at_both_ends();
    trim_of_blank_input_is_empty();

    is_comment_accepts_hash_and_semicolon();
    is_comment_rejects_content_and_empty_lines();

    section_header_yields_the_trimmed_name();
    section_header_rejects_malformed_lines();

    key_value_splits_on_the_first_equals_only();
    key_value_trims_both_sides();
    key_value_allows_an_empty_value();
    key_value_rejects_missing_equals_or_empty_key();

    parse_config_reads_sections_keys_comments_and_blanks();
    parse_config_counts_malformed_lines_and_keeps_going();
    parse_config_puts_keys_before_any_header_in_the_global_section();
    parse_config_keeps_the_last_of_duplicate_keys();
    parse_config_keeps_a_section_that_has_no_keys();
    parse_config_treats_comment_markers_inside_a_value_as_data();
    parse_config_strips_crlf_line_endings();
    parse_config_on_empty_input_yields_nothing();
    parse_config_accepts_a_last_line_without_a_newline();

    std::printf("config_test: all tests passed\n");
    return 0;
}
