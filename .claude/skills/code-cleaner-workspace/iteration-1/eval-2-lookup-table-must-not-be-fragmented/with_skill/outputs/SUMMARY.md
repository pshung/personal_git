# SUMMARY

## What changed

Three files modified, nothing added, nothing deleted. `CMakeLists.txt` is
**unchanged** (copied to outputs only because the task listed it).

| File | Change |
|---|---|
| `src/opcode.hpp` | Added `OPCODE_LIST(X)` - one row per opcode, `X(ENUM, "name")` - as the single source of truth. The `Op` enum is now generated from it, plus a `COUNT` sentinel. All 30 opcodes from `docs/opcodes.txt` appended after the original 10, in document order, so existing enumerator values are unchanged. |
| `src/opcode.cpp` | Replaced the 10-case `switch` with a `constexpr const char* kOpcodeNames[]` generated from the same `OPCODE_LIST`, plus a `static_assert` tying the table length to `Op::COUNT`. `opcode_name()` is now a range check and one index. |
| `tests/opcode_test.cpp` | Replaced the 2-assert smoke test with 4 table-driven checks covering all 40 mappings, enum/table index alignment, display-name uniqueness, and the out-of-range fallback. |

Verified mechanically that the 30 new rows match `docs/opcodes.txt` exactly and
in order:

```sh
grep -oE '^\s+X\(([A-Z]+), *"([a-z]+)"\)' src/opcode.hpp \
  | sed -E 's/^\s+X\(([A-Z]+), *"([a-z]+)"\)/\1 \2/' | tail -n +11 > have_new.txt
grep -v '^#' docs/opcodes.txt | awk 'NF{print $1, $2}' > want.txt
diff want.txt have_new.txt        # -> no output
```

## Shape of `opcode_name()`, and why

It is **one function, one table** - 8 lines:

```cpp
const char* opcode_name(Op op)
{
  const auto index = static_cast<std::size_t>(op);
  if (index >= static_cast<std::size_t>(Op::COUNT)) {
    return "?";
  }
  return kOpcodeNames[index];
}
```

Reasoning, in order of what was ruled out:

1. **Not split into helpers.** The obvious way to make a 40-branch function's
   number look good is `opcode_name_arith()` / `_load()` / `_branch()` /
   `_system()` chained together. That is fragmenting a lookup table to game the
   metric: the mapping stops being readable as one list, and adding an opcode
   makes you first decide *which* helper owns it. The skill's
   `references/cc-judgment.md` calls this out explicitly. Rejected.

2. **Not left as a 40-case switch.** A flat lookup switch is a documented CC
   false positive, so keeping it would have been defensible - but I measured it
   rather than assumed: the generated 40-case version scores **CC 41, "OVER:
   split it"**. CC 41 alone exceeds the CRAP-30 budget, so no amount of coverage
   can bring it under; the gate would fail forever and each new opcode would cost
   +1 CC. Rejected because a genuinely better shape was available at no cost.

3. **Table, driven by an X-macro list.** `SKILL.md`: "Prefer a table to a branch
   chain ... costs CC 1 plus a loop, and adding a case later costs nothing." The
   X-macro is what makes the task's "keep `opcode.hpp`'s `Op` enum in sync"
   requirement structural instead of a convention: the enum and the name table
   expand from the *same* list, so they cannot drift, and an opcode is added by
   editing exactly one line. The `static_assert` on `Op::COUNT` is a
   belt-and-braces compile-time check, and the test's own `static_assert` means
   a new opcode without a test row also fails to compile.

The single remaining branch is the range guard for values cast in from outside
the enum. It preserves the original `"?"` fallback (a `switch` with no `default`
had the same behaviour) and it is covered by a test.

## Measured numbers

All from the skill's scripts, `SKILL=~/.claude/skills/code-cleaner`. Raw output
in `measurement.txt`.

```sh
$SKILL/scripts/cc.sh src/opcode.cpp
$SKILL/scripts/cov_build.sh
$SKILL/scripts/crap.sh --filter 'src/'
```

| function | CC | coverage | CRAP | budget |
|---|---|---|---|---|
| `opcode_name` (src/opcode.cpp:21) | **2** | **100.0%** | **2** | 30 - pass |

`crap.sh` output: `1 gated, 0 over budget (0 not gated)`, exit 0.

Rejected-alternative measurement, for comparison (generated into a scratch file,
not committed):

| shape | CC | verdict from `cc.sh` |
|---|---|---|
| 40-case `switch` | 41 | `OVER: split it` - unreachable under CRAP 30 at any coverage |
| table + range guard (shipped) | 2 | `ok untested` (and it is tested anyway) |

Test-side complexity, also measured: `check_every_opcode_maps_to_its_display_name`
CC 4, `check_display_names_are_unique` CC 3, `check_names_are_indexed_by_enum_value`
CC 2, `check_out_of_range_value_falls_back` CC 1, `main` CC 1.

Build/test: `cmake` + `ctest` in `build-coverage`, 1/1 passed. Also built clean
with `g++ -std=c++17 -Wall -Wextra` - no warnings.

## Process note

TDD order was followed: `tests/opcode_test.cpp` was rewritten first and failed
for the right reason (`error: 'LDB' is not a member of 'Op'`, and `Op::COUNT`
undeclared) before either source file was touched.

Untracked byproducts left in the repo: `.crap.conf` (written by `cov_build.sh`)
and `build-coverage/`. Work is uncommitted as instructed.
