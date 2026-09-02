# cfgtool INI parser - what was built and what it measures

## What was built

`src/config.hpp` + `src/config.cpp` - an INI-style parser, plus
`tests/config_test.cpp` (plain asserts, no framework) and the CMakeLists block
uncommented exactly as the repo showed it.

Public API:

```cpp
namespace cfgtool {
using Section = std::map<std::string, std::string>;
struct Config {
    std::map<std::string, Section> sections;  // "" = keys before the first [section]
    std::size_t bad_lines = 0;
};
Config parse_config(std::istream& in);
}
```

Behavior, per line, after trimming both ends:

| line | result |
|---|---|
| empty | ignored |
| starts `#` or `;` | ignored |
| `[name]` | section header; `name` trimmed, must be non-empty |
| `key=value` | split at the **first** `=` only; both sides trimmed; key must be non-empty |
| anything else | skipped, `++bad_lines` |

Decisions worth flagging (all documented in the header and pinned by a test):

- **Whole-line comments only.** Stripping inline `#`/`;` would corrupt any value
  containing them, and the request said values are free-form (they may hold `=`),
  so `msg = a # b ; c` keeps its full value.
- **Keys before the first header** go into the section named `""`, which is
  created only if such a key exists.
- **`[]` and `[   ]` are malformed**, not a section named `""` - otherwise a typo
  would silently merge into the global section.
- **Duplicate key: last wins.**
- **A header with no keys still creates an empty section.**
- `trim`'s whitespace set includes `\r`, so CRLF files work with no extra branch.

## How it was decomposed, and why

The skill's lever for complexity is to give each function one job and to pull the
loop body out of the loop. So the file is a 4-step pipeline plus the iteration:

| function | job | CC |
|---|---|---|
| `detail::trim` | strip whitespace from both ends | 2 |
| `detail::is_comment` | is this trimmed line a comment? | 3 |
| `detail::parse_section_header` | `[name]` -> name, or nullopt | 5 |
| `detail::parse_key_value` | `k=v` -> key+value, or nullopt | 3 |
| `detail::apply_line` | classify one line, fold it into the config (the extracted loop body) | 5 |
| `parse_config` | iterate lines, count the ones `apply_line` rejected | 3 |

Two things fall out of this shape:

- **Branching lives at the edges.** The three recognisers each `return nullopt`
  on bad input, so `apply_line` is a flat try-in-order chain with no nesting, and
  `parse_config` is a 3-line loop. Nothing re-validates what it was handed.
- **Every error path is testable without I/O.** The malformed cases (`[main`,
  `[]`, `=orphan`, a line with no `=`) are one direct call each on a
  `string_view` - no stream setup - which is why the error branches are covered
  at all. The helpers live in `namespace detail` in the public header: reachable
  by the test, marked as not the stable API.

The helpers return `string_view`s into the caller's buffer (documented); only
`apply_line` copies, at the point the data enters the map.

19 test cases, one per distinct decision outcome including every rejection path.
`#undef NDEBUG` at the top of the test so the asserts cannot be compiled away by
a Release build.

## Measured numbers

Everything below is measured, not estimated. Budget is CRAP <= 30 per function.

| function | CC | line coverage | CRAP |
|---|---|---|---|
| `cfgtool::detail::apply_line` | 5 | 100.0% | 5 |
| `cfgtool::detail::parse_section_header` | 5 | 100.0% | 5 |
| `cfgtool::parse_config` | 3 | 100.0% | 3 |
| `cfgtool::detail::parse_key_value` | 3 | 100.0% | 3 |
| `cfgtool::detail::is_comment` | 3 | 100.0% | 3 |
| `cfgtool::detail::trim` | 2 | 100.0% | 2 |

`6 gated, 0 over budget`. Worst function is CRAP 5 against a budget of 30. Max CC
is 5, which is the "passes untested" tier - so the coverage is headroom for
whoever adds the next branch, not something the current code needs to stay legal.

gcov cross-check on `src/config.cpp`: `Lines executed:100.00% of 37`,
`Branches executed:100.00% of 72`, `Taken at least once:75.00% of 72`. (The 75%
is the usual gcc artefact - it counts each short-circuit and cleanup edge in both
directions; all 72 branch points were reached.)

Also clean under `g++ -std=c++17 -Wall -Wextra -Wpedantic` for both files.

### Exact commands

```sh
SKILL=~/.claude/skills/code-cleaner

# functional tests
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug && cmake --build build -j
ctest --test-dir build --output-on-failure        # 1/1 Passed

# complexity (no build needed)
$SKILL/scripts/cc.sh src/config.cpp

# instrumented build + test run, then score
$SKILL/scripts/cov_build.sh
$SKILL/scripts/crap.sh --filter 'src/'            # exit 0

# branch cross-check
cd build-coverage/CMakeFiles/config_test.dir/src && gcov -b config.cpp.gcda

# warnings
g++ -std=c++17 -Wall -Wextra -Wpedantic -c src/config.cpp        -Isrc -o /dev/null
g++ -std=c++17 -Wall -Wextra -Wpedantic -c tests/config_test.cpp -Isrc -o /dev/null
```

Raw output of the whole run is in `measurement.txt`.

Toolchain: g++ 16.1.1, gcov 16.1.1, lizard 1.24.0.

## Process note

TDD order was followed: the test file and header went in first and were built
against a throwaway stub implementation (kept outside the repo, in scratchpad) to
confirm a genuine runtime RED - `Assertion 'detail::trim("  a b  ") == "a b"'
failed`, exit 134 - not just a link error. `src/config.cpp` was written after
that, turning the suite green.

Build artifacts (`build/`, `build-coverage/`, `.crap.conf`) were removed
afterwards, so `git status` shows only `CMakeLists.txt`, `src/`, `tests/`.
