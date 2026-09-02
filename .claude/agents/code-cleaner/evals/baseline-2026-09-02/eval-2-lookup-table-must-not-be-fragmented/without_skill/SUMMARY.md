# SUMMARY

## What I changed

Four files, all left uncommitted in the repo:

| File | Change |
|------|--------|
| `src/opcode.hpp` | Added the `OPCODE_LIST(X)` table (40 entries: the 10 pre-existing + the 30 from `docs/opcodes.txt`) and generate the `Op` enum from it. |
| `src/opcode.cpp` | `opcode_name()` is now a direct index into one contiguous name array expanded from the same `OPCODE_LIST`. The 10-case `switch` is gone. |
| `tests/opcode_test.cpp` | Grew from 2 assertions to 40 explicit name expectations + a whole-range "every opcode is named and no two share a name" sweep + 2 out-of-range cases. |
| `CMakeLists.txt` | `-Wall -Wextra`, `CMAKE_CXX_STANDARD_REQUIRED`, and an `OPCODES_COVERAGE` option that turns on `--coverage -O0 -g` so the gcov number below is reproducible. |

All 30 opcodes from `docs/opcodes.txt` were added in document order, appended
after the original 10. The original 10 keep their original positions, so any
already-serialized `Op` integer values are unchanged.

## What shape I gave `opcode_name()`, and why

**One flat lookup table, generated from one list, read with one index.**

```cpp
// opcode.hpp - the single source of truth
#define OPCODE_LIST(X) \
  X(NOP, "nop")        \
  ...                  \
  X(CSRRC, "csrrc")

enum class Op {
#define OPCODE_ENUMERATOR(enumerator, display_name) enumerator,
  OPCODE_LIST(OPCODE_ENUMERATOR)
#undef OPCODE_ENUMERATOR
};
```

```cpp
// opcode.cpp - same list, same order, so entry N is always enumerator N
constexpr const char* kOpcodeNames[] = {
#define OPCODE_NAME(enumerator, display_name) display_name,
    OPCODE_LIST(OPCODE_NAME)
#undef OPCODE_NAME
};

const char* opcode_name(Op op)
{
  const std::size_t index = static_cast<std::size_t>(op);
  if (index >= std::size(kOpcodeNames)) {
    return "?";
  }
  return kOpcodeNames[index];
}
```

Reasons, in priority order:

1. **The mapping stays in one piece.** Forty entries live in one contiguous,
   column-aligned block that you read top to bottom. The obvious alternatives
   both fragment it: 40 `case` labels is one block but 40 branches, and
   splitting into `opcode_name_load()` / `opcode_name_branch()` /
   `opcode_name_csr()` helpers to dodge a complexity threshold would scatter a
   single fact (which enum prints which string) across several functions and add
   a dispatch layer whose only job is to undo the split. Answering "what does
   `BGEU` print?" must never require reading more than one place.
2. **"Keep the enum in sync" becomes structural, not a habit.** The enum and the
   table are two expansions of the same 40 lines, so they cannot drift: there is
   no way to add an enumerator without adding its name, no way to insert one in
   the middle and shift the table off by one, and no way to reorder one without
   reordering the other. Adding an opcode is one line in one file. A `switch`
   (or a hand-written parallel array) makes sync something a reviewer has to
   re-check every time.
3. **The mapping is data, so it is not control flow.** The 30 new opcodes add 30
   table rows and zero branches. `opcode_name()` has exactly one branch, the
   range guard, which is the only thing in it that can be wrong at runtime.
   Complexity now stays flat no matter how many opcodes are added later; with
   the `switch` it grew by one per opcode.
4. **Same observable behavior.** Unknown values still return `"?"`, and all 10
   pre-existing names are byte-identical.

Cost of the macro, stated honestly: `Op::LDB` no longer appears literally in the
header, so jump-to-definition lands on `OPCODE_LIST` rather than on the
enumerator. Grep for the name still finds it. I judged compile-time-guaranteed
sync worth that, given "keep the enum in sync" was an explicit requirement.

## Measurements

Everything below was measured, not estimated. Exact commands and their output:

### Cyclomatic complexity (lizard 1.17.31)

Before, on the original 10-case switch:

```sh
git stash && lizard src/opcode.cpp && git stash pop
#   NLOC  CCN  token  PARAM  length  location
#     16   11     96      1      16  opcode_name@3-18@src/opcode.cpp
```

After:

```sh
lizard src/opcode.cpp src/opcode.hpp
#   NLOC  CCN  token  PARAM  length  location
#      8    2     45      1       8  opcode_name@19-26@src/opcode.cpp
```

**CCN 11 -> 2, while the opcode count went 10 -> 40.** Had I kept the switch and
added 30 cases, CCN would be ~41, over lizard's default warning threshold of 15.

### Coverage (gcov 15.2.1, GCC 15.2.1)

```sh
cmake -S . -B build-cov -DOPCODES_COVERAGE=ON && cmake --build build-cov
./build-cov/opcode_test                     # exit 0
gcov -b -f build-cov/CMakeFiles/opcode_test.dir/src/opcode.cpp.gcda
```

```
Function '_Z11opcode_name2Op'
Lines executed:100.00% of 5
Branches executed:100.00% of 2
Taken at least once:100.00% of 2
```

**100% line, 100% branch on `src/opcode.cpp`.** Both directions of the range
guard are exercised: the in-range side by the 40 name expectations, the
out-of-range side by `opcode_name(static_cast<Op>(40))` and
`opcode_name(static_cast<Op>(1000))`.

CRAP score = `CC + CC^2 * (1 - coverage)^3` = `2 + 4 * 0^3` = **2** (computed by
hand from the two measured numbers above, not from a tool).

### Test suite

```sh
cmake -S . -B build && cmake --build build && ctest --test-dir build --output-on-failure
# 100% tests passed, 0 tests failed out of 1
```

Build is warning-clean under `-Wall -Wextra`.

### Test-quality checks (the numbers above only mean something if the test bites)

**Red first.** I wrote the 40-expectation test before touching `src/`. It failed
to compile with `error: 'LDB' is not a member of 'Op'` (30 such errors), which is
the right reason. Then I added the enum and the table, and it went green.

**Mutation check.** With the finished code, I flipped one table entry
(`X(BLTU, "bltu")` -> `X(BLTU, "bgeu")`), rebuilt, and ran the test:

```
FAIL: opcode_name(22): expected "bltu", got "bgeu"
FAIL: opcodes 22 and 23 share the name "bgeu"
2 check(s) failed
mutant exit: 1
```

Both independent checks fired: the explicit expectation and the distinctness
sweep. The entry was reverted immediately. This matters because a table of 40
string literals fails by copy-paste duplication and by off-by-one, and 100% line
coverage alone catches neither - one wrong string still executes the same single
line. The per-opcode expectations are what actually pin the contents.

**Source cross-check.** I parsed `docs/opcodes.txt` and `src/opcode.hpp` and
compared them programmatically rather than by eye:

```sh
python3 - <<'EOF'
import re
doc = [l.split() for l in open('docs/opcodes.txt') if l.strip() and not l.startswith('#')]
hpp = re.findall(r'X\((\w+), "([^"]+)"\)', open('src/opcode.hpp').read())
...
EOF
# doc entries: 30 | X-macro entries: 40
# mismatches vs docs: none
# doc order preserved: True
# duplicate display names: none
```

### Not measured

No performance or benchmark numbers were taken; the change is a switch-to-array
lookup and I did not time it. No static analysis beyond lizard and `-Wall
-Wextra` (no clang-tidy, no cppcheck). `gcovr` and `lcov` are not installed on
this machine, so the coverage figure comes from `gcov` directly rather than from
an aggregated HTML/XML report.
