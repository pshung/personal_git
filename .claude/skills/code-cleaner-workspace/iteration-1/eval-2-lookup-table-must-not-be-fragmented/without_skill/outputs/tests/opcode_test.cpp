#include "opcode.hpp"
#include <cstdio>
#include <cstring>

namespace {

int failures = 0;

void expect_name(Op op, const char* expected)
{
  const char* actual = opcode_name(op);
  if (std::strcmp(actual, expected) != 0) {
    std::fprintf(stderr, "FAIL: opcode_name(%d): expected \"%s\", got \"%s\"\n",
                 static_cast<int>(op), expected, actual);
    ++failures;
  }
}

// Every enumerator below must have its own entry in the lookup table; the first
// value past the end must fall back to the unknown-opcode string.
constexpr int kOpcodeCount = 40;

void expect_every_opcode_named_and_distinct()
{
  for (int i = 0; i < kOpcodeCount; ++i) {
    const char* name = opcode_name(static_cast<Op>(i));
    if (name[0] == '\0' || std::strcmp(name, "?") == 0) {
      std::fprintf(stderr, "FAIL: opcode %d has no display name\n", i);
      ++failures;
    }
    for (int j = 0; j < i; ++j) {
      if (std::strcmp(name, opcode_name(static_cast<Op>(j))) == 0) {
        std::fprintf(stderr, "FAIL: opcodes %d and %d share the name \"%s\"\n",
                     j, i, name);
        ++failures;
      }
    }
  }
}

}  // namespace

int main()
{
  expect_name(Op::NOP, "nop");
  expect_name(Op::ADD, "add");
  expect_name(Op::SUB, "sub");
  expect_name(Op::MUL, "mul");
  expect_name(Op::DIV, "div");
  expect_name(Op::AND, "and");
  expect_name(Op::OR, "or");
  expect_name(Op::XOR, "xor");
  expect_name(Op::SHL, "shl");
  expect_name(Op::SHR, "shr");

  expect_name(Op::LDB, "ldb");
  expect_name(Op::LDH, "ldh");
  expect_name(Op::LDW, "ldw");
  expect_name(Op::LDD, "ldd");
  expect_name(Op::STB, "stb");
  expect_name(Op::STH, "sth");
  expect_name(Op::STW, "stw");
  expect_name(Op::STD, "std");
  expect_name(Op::BEQ, "beq");
  expect_name(Op::BNE, "bne");
  expect_name(Op::BLT, "blt");
  expect_name(Op::BGE, "bge");
  expect_name(Op::BLTU, "bltu");
  expect_name(Op::BGEU, "bgeu");
  expect_name(Op::JAL, "jal");
  expect_name(Op::JALR, "jalr");
  expect_name(Op::LUI, "lui");
  expect_name(Op::AUIPC, "auipc");
  expect_name(Op::SLT, "slt");
  expect_name(Op::SLTU, "sltu");
  expect_name(Op::REM, "rem");
  expect_name(Op::REMU, "remu");
  expect_name(Op::DIVU, "divu");
  expect_name(Op::MULH, "mulh");
  expect_name(Op::FENCE, "fence");
  expect_name(Op::ECALL, "ecall");
  expect_name(Op::EBREAK, "ebreak");
  expect_name(Op::CSRRW, "csrrw");
  expect_name(Op::CSRRS, "csrrs");
  expect_name(Op::CSRRC, "csrrc");

  expect_every_opcode_named_and_distinct();

  // Out-of-range values are not a crash; they report as unknown.
  expect_name(static_cast<Op>(kOpcodeCount), "?");
  expect_name(static_cast<Op>(1000), "?");

  if (failures != 0) {
    std::fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
  }
  return 0;
}
