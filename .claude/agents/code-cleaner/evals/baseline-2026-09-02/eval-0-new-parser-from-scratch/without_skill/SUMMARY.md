# cfgtool INI config parser - summary

## What I built

An INI-style config parser for cfgtool, in `src/config.hpp` + `src/config.cpp`,
with a plain-assert test binary wired into ctest.

Public API (namespace `cfgtool`):

```cpp
using ConfigSection = std::map<std::string, std::string>;

struct ConfigResult {
    std::map<std::string, ConfigSection> sections;
    std::size_t bad_lines = 0;
};

ConfigResult parse_config(std::istream& in);
```

`bad_lines` is the count the CLI needs in order to warn. Malformed lines are
skipped, never fatal, and parsing continues with the next line.

### Line grammar

| Line form | Behavior |
|---|---|
| empty / all whitespace | ignored |
| first non-space char is `#` or `;` | ignored (whole-line comment) |
| `[name]` | switches section; `name` is trimmed and must be non-empty |
| `key = value` | split on the FIRST `=`; both sides trimmed; stored |
| anything else | `++bad_lines`, line skipped |

### Behavior decisions I had to make (the request did not pin these down)

These are documented in the header comment of `config.hpp` so the next reader
does not have to re-derive them, and each one has a test.

1. **Only whole-line comments.** `#` and `;` inside a value are ordinary
   characters. This is the same principle as "values can contain `=`": the
   request explicitly wanted values not to be mangled by a delimiter, and
   inline-comment stripping would silently truncate `color=#ff00ff` and any
   value containing a URL fragment or a `;`-separated list. Stripping is not
   recoverable by the caller; not stripping is.
2. **Keys before the first `[section]`** go into the section named `""` (the
   global section), rather than counting as malformed. Real config files do
   this and the data is unambiguous.
3. **A key may not be empty, a value may.** `key =` yields `""`; `= value` is
   malformed. An empty key has no name to look up under, so it is unusable data.
4. **A malformed header does not change the current section.** After `[a]` then
   `[oops`, subsequent keys still land in `a`. The alternative (dropping into
   the global section) would silently relocate valid keys because of one bad
   line.
5. **A header with no keys still declares an empty section**, so the CLI can
   tell "section present but empty" from "section absent".
6. **Repeated key: last wins. Repeated section: merged.** Standard INI
   behavior, and it makes a config file overridable by appending to it.
7. **CRLF works for free** because `\r` is in the whitespace set that trim
   uses; no special case in the code.
8. Ordering is `std::map` (sorted by name), not file order. Config lookup is
   by name, so sorted order is the useful one and it makes tests deterministic.

## How I decomposed it, and why

`parse_config` is the only public function. Behind it, in an anonymous
namespace, are four single-purpose helpers:

| Function | Job |
|---|---|
| `trim(string_view) -> string_view` | drop leading/trailing whitespace |
| `is_comment_marker(char) -> bool` | is this char `#` or `;` |
| `parse_section_header(string_view) -> optional<string_view>` | `"[ a ]"` -> `"a"`, or nullopt if malformed |
| `split_key_value(string_view) -> optional<pair<sv,sv>>` | split on first `=`, trim both, or nullopt if malformed |
| `parse_config(istream&) -> ConfigResult` | read lines, classify, accumulate |

Reasons for this split rather than one loop with inline string work:

- **The "is this line valid" decision is expressed once per line kind.** Each
  helper returns `optional`, so "malformed" is a value, not a flag or an
  exception. `parse_config` then has exactly two `++bad_lines` sites, one per
  line kind, which is why the bad-line count is easy to trust.
- **Each helper is independently checkable.** The trimming rule, the
  first-`=`-only rule, and the header rule are the three things most likely to
  be wrong, and each lives in one place with no surrounding context.
- **`string_view` throughout the helpers**, with `std::string` constructed only
  at the point of insertion into the map. Trimming does not allocate.
- The helpers are file-local (anonymous namespace), so the header stays down to
  the two types and the one function the CLI actually calls.
- `is_comment_marker` takes a `char` rather than the line. That started as
  `is_comment(string_view)` with a `!text.empty() &&` guard; the coverage run
  showed that guard could never be false, because the caller's
  `text.empty() ||` short-circuit already handles it. Passing the char removes
  the unreachable branch and removes the possibility of calling `front()` on an
  empty view. See "what measurement changed" below.

## Process

TDD. `tests/config_test.cpp` (18 test functions) was written first and the
build was confirmed failing for the right reason - `Cannot find source file:
src/config.cpp` - before any implementation existed. Then the header and
implementation, then two refactors with the tests green.

## Numbers I measured

All commands run from the repo root. `gcovr` and `lcov` are not installed on
this machine, so coverage is plain `gcov`.

### Build and test

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build
ctest --test-dir build --output-on-failure
```

Result: `100% tests passed, 0 tests failed out of 1` (the ctest test is the
`config_test` binary; it runs 18 assert-based test functions and prints
`all config parser tests passed`).

### Compiler warnings

```sh
g++     -std=c++17 -Wall -Wextra -Wpedantic -Wshadow -Wconversion -Isrc -c src/config.cpp -o /dev/null
clang++ -std=c++17 -Wall -Wextra -Wpedantic -Wshadow             -Isrc -c src/config.cpp -o /dev/null
```

Result: **zero warnings from both compilers.**

### Cyclomatic complexity

```sh
lizard src/config.cpp
```

| Function | NLOC | CCN | tokens |
|---|---|---|---|
| `trim` | 7 | 2 | 57 |
| `is_comment_marker` | 3 | 2 | 16 |
| `parse_section_header` | 10 | 4 | 76 |
| `split_key_value` | 11 | 3 | 92 |
| `parse_config` | 26 | 7 | 170 |

Totals: **5 functions, 67 NLOC, average CCN 3.6, max CCN 7** (`parse_config`).
Lizard reports `No thresholds exceeded`. Nothing is close to the usual CCN 10
budget; the single largest function is the dispatch loop, whose 7 comes from
one loop plus the four line-kind decisions, which is the irreducible shape of
the grammar.

### Coverage

```sh
cmake -S . -B build-cov -DCMAKE_BUILD_TYPE=Debug \
      -DCMAKE_CXX_FLAGS="--coverage -O0 -g" -DCMAKE_EXE_LINKER_FLAGS="--coverage"
cmake --build build-cov
ctest --test-dir build-cov
cd build-cov && gcov -b CMakeFiles/config_test.dir/src/config.cpp.gcda
```

gcov output for `src/config.cpp`:

```
Lines executed:100.00% of 42
Branches executed:100.00% of 68
Taken at least once:73.53% of 68
Calls executed:91.23% of 57
```

**Line coverage 100% (42/42). Real branch coverage 100%.**

The `73.53% taken at least once` needs the qualification. 18 of the 68 branches
were never taken; I checked every one of them and all 18 are compiler-generated
exception-unwind edges, which gcov labels `(throw)` - the `std::string` and
`std::map` allocation paths. They are unreachable without an allocation
failure. Counted and cross-checked with:

```sh
grep -E "^ *branch" config.cpp.gcov | grep -E "taken 0%|never executed" | wc -l         # -> 18
grep -E "^ *branch" config.cpp.gcov | grep -E "taken 0%|never executed" | grep -c throw # -> 18
```

Both are 18, so the sets are identical: of the 50 real branches in the source,
**50 are taken both ways.**

### What the measurement actually changed

The first coverage run reported `Taken at least once: 72.86% of 70` with **one
non-throw** uncovered branch: in `is_comment(string_view)`, the
`!text.empty()` guard, whose false edge showed `branch 2 taken 0%`. That was
not a missing test - it was unreachable code, because `parse_config` already
short-circuits on `text.empty()`. Fixing it by adding a test was impossible;
the correct fix was to delete the redundant guard, which I did by changing the
helper to take a `char`. That dropped its CCN from 3 to 2 and removed the
latent UB of `front()` on an empty view. This is the one place where the
measurement, not review, found the defect.

### Mutation check (are the tests actually load-bearing?)

Line and branch coverage only prove code ran, not that a wrong answer would be
caught. I injected 10 deliberate defects one at a time into a scratch copy of
`config.cpp`, rebuilt, and ran the test binary, expecting a failure each time:

| Mutation | Result |
|---|---|
| split on last `=` instead of first | killed |
| stop counting bad `key=value` lines | killed |
| do not trim the value | killed |
| do not trim the key | killed |
| `;` no longer starts a comment | killed |
| accept an empty key | killed |
| accept an empty section name | killed |
| do not require the closing `]` | killed |
| header no longer declares an empty section | killed |
| trim drops only leading whitespace | killed |

**10 of 10 mutants killed.** The script that does this is not part of the
deliverable; it copied `src/*` and `tests/config_test.cpp` into a temp dir,
applied one `sed` per mutant (verifying the `sed` actually changed the file),
compiled with
`g++ -std=c++17 -I<dir> -o t config_test.cpp config.cpp`, and reported whether
the binary still exited 0.

## Files

| File | Status |
|---|---|
| `src/config.hpp` | new - 48 lines, public API + documented grammar |
| `src/config.cpp` | new - 90 lines, 5 functions |
| `tests/config_test.cpp` | new - 203 lines, 18 assert-based tests |
| `CMakeLists.txt` | modified - uncommented the 3-line test block as-is |

`CMakeLists.txt` was changed only by uncommenting the existing block; the
target name, include dir and test name are exactly the ones the skeleton
specified. The test file does `#undef NDEBUG` before `<cassert>` so the asserts
survive a release-flavored build type.

Build directories were removed after measuring; the repo tree contains only
source. Work is left uncommitted.
