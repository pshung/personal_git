// Plain-assert tests for the cfgtool INI parser. No framework: every check is
// an assert(), main() returns 0 when all of them held.
//
// NDEBUG is undefined on purpose so the asserts survive a -DNDEBUG build type.
#undef NDEBUG
#include <cassert>

#include <cstdio>
#include <sstream>
#include <string>

#include "config.hpp"

using cfgtool::ConfigResult;
using cfgtool::parse_config;

namespace {

ConfigResult parse(const std::string& text) {
    std::istringstream in(text);
    return parse_config(in);
}

void expect_value(const ConfigResult& result, const std::string& section, const std::string& key,
                  const std::string& value) {
    assert(result.sections.count(section) == 1);
    const auto& entries = result.sections.at(section);
    assert(entries.count(key) == 1);
    assert(entries.at(key) == value);
}

void test_empty_input_yields_nothing() {
    const ConfigResult result = parse("");
    assert(result.sections.empty());
    assert(result.bad_lines == 0);
}

void test_section_with_one_pair() {
    const ConfigResult result = parse("[server]\nhost=localhost\n");
    assert(result.sections.size() == 1);
    expect_value(result, "server", "host", "localhost");
    assert(result.bad_lines == 0);
}

void test_trims_whitespace_around_key_value_and_section() {
    const ConfigResult result = parse("  [ server ]  \n\t host \t = \t localhost \t \n");
    expect_value(result, "server", "host", "localhost");
    assert(result.bad_lines == 0);
}

void test_comments_and_blank_lines_are_skipped() {
    const ConfigResult result = parse(
        "# hash comment\n"
        "; semicolon comment\n"
        "\n"
        "   \t  \n"
        "   # indented comment\n"
        "[a]\n"
        "k=v\n");
    expect_value(result, "a", "k", "v");
    assert(result.sections.size() == 1);
    assert(result.bad_lines == 0);
}

void test_value_may_contain_equals_signs() {
    const ConfigResult result = parse("[a]\nquery=x=1&y=2\n");
    expect_value(result, "a", "query", "x=1&y=2");
    assert(result.bad_lines == 0);
}

void test_comment_characters_inside_a_value_are_kept() {
    const ConfigResult result = parse("[a]\ncolor=#ff00ff\nnote=a ; b\n");
    expect_value(result, "a", "color", "#ff00ff");
    expect_value(result, "a", "note", "a ; b");
    assert(result.bad_lines == 0);
}

void test_keys_before_any_section_land_in_the_global_section() {
    const ConfigResult result = parse("top=1\n[a]\nk=v\n");
    expect_value(result, "", "top", "1");
    expect_value(result, "a", "k", "v");
    assert(result.sections.size() == 2);
    assert(result.bad_lines == 0);
}

void test_header_alone_declares_an_empty_section() {
    const ConfigResult result = parse("[empty]\n");
    assert(result.sections.count("empty") == 1);
    assert(result.sections.at("empty").empty());
    assert(result.bad_lines == 0);
}

void test_repeated_section_merges_and_repeated_key_takes_the_last_value() {
    const ConfigResult result = parse("[a]\nk=1\nj=9\n[a]\nk=2\n");
    assert(result.sections.size() == 1);
    expect_value(result, "a", "k", "2");
    expect_value(result, "a", "j", "9");
    assert(result.bad_lines == 0);
}

void test_empty_value_is_allowed() {
    const ConfigResult result = parse("[a]\nk=\nj=   \n");
    expect_value(result, "a", "k", "");
    expect_value(result, "a", "j", "");
    assert(result.bad_lines == 0);
}

void test_line_without_equals_is_bad() {
    const ConfigResult result = parse("[a]\njust some words\n");
    assert(result.sections.at("a").empty());
    assert(result.bad_lines == 1);
}

void test_line_without_a_key_is_bad() {
    const ConfigResult result = parse("[a]\n=orphan\n   =orphan2\n");
    assert(result.sections.at("a").empty());
    assert(result.bad_lines == 2);
}

void test_broken_section_headers_are_bad() {
    const ConfigResult result = parse(
        "[unterminated\n"
        "[]\n"
        "[   ]\n"
        "[trailing] junk\n"
        "[\n");
    assert(result.sections.empty());
    assert(result.bad_lines == 5);
}

void test_parsing_continues_after_a_bad_line() {
    const ConfigResult result = parse("[a]\nbroken\nk=v\n[bad\nj=w\n");
    expect_value(result, "a", "k", "v");
    expect_value(result, "a", "j", "w");
    assert(result.bad_lines == 2);
}

void test_a_bad_header_does_not_change_the_current_section() {
    const ConfigResult result = parse("[a]\n[oops\nk=v\n");
    expect_value(result, "a", "k", "v");
    assert(result.sections.size() == 1);
    assert(result.bad_lines == 1);
}

void test_crlf_line_endings_are_handled() {
    const ConfigResult result = parse("[a]\r\nk=v\r\n");
    expect_value(result, "a", "k", "v");
    assert(result.bad_lines == 0);
}

void test_last_line_without_a_trailing_newline_is_parsed() {
    const ConfigResult result = parse("[a]\nk=v");
    expect_value(result, "a", "k", "v");
    assert(result.bad_lines == 0);
}

void test_realistic_file() {
    const ConfigResult result = parse(
        "; cfgtool sample\n"
        "verbose = 1\n"
        "\n"
        "[server]\n"
        "host = 10.0.0.1   # not a comment, part of the value\n"
        "port = 8080\n"
        "\n"
        "[auth]\n"
        "token = abc=def==\n"
        "this line is broken\n"
        "[limits]\n"
        "max = 10\n");
    expect_value(result, "", "verbose", "1");
    expect_value(result, "server", "host", "10.0.0.1   # not a comment, part of the value");
    expect_value(result, "server", "port", "8080");
    expect_value(result, "auth", "token", "abc=def==");
    expect_value(result, "limits", "max", "10");
    assert(result.sections.size() == 4);
    assert(result.bad_lines == 1);
}

}  // namespace

int main() {
    test_empty_input_yields_nothing();
    test_section_with_one_pair();
    test_trims_whitespace_around_key_value_and_section();
    test_comments_and_blank_lines_are_skipped();
    test_value_may_contain_equals_signs();
    test_comment_characters_inside_a_value_are_kept();
    test_keys_before_any_section_land_in_the_global_section();
    test_header_alone_declares_an_empty_section();
    test_repeated_section_merges_and_repeated_key_takes_the_last_value();
    test_empty_value_is_allowed();
    test_line_without_equals_is_bad();
    test_line_without_a_key_is_bad();
    test_broken_section_headers_are_bad();
    test_parsing_continues_after_a_bad_line();
    test_a_bad_header_does_not_change_the_current_section();
    test_crlf_line_endings_are_handled();
    test_last_line_without_a_trailing_newline_is_parsed();
    test_realistic_file();
    std::puts("all config parser tests passed");
    return 0;
}
