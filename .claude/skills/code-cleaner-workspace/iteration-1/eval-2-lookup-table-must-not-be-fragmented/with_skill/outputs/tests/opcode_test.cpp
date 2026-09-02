#include "opcode.hpp"
#include <cassert>
#include <cstring>
#include <cstdio>

namespace {

struct Case {
  Op op;
  const char* expect;
};

// One row per Op. Kept as data so a new opcode is one line here too, and so a
// failure names the opcode instead of a line number.
const Case kCases[] = {
    {Op::NOP, "nop"},     {Op::ADD, "add"},     {Op::SUB, "sub"},
    {Op::MUL, "mul"},     {Op::DIV, "div"},     {Op::AND, "and"},
    {Op::OR, "or"},       {Op::XOR, "xor"},     {Op::SHL, "shl"},
    {Op::SHR, "shr"},     {Op::LDB, "ldb"},     {Op::LDH, "ldh"},
    {Op::LDW, "ldw"},     {Op::LDD, "ldd"},     {Op::STB, "stb"},
    {Op::STH, "sth"},     {Op::STW, "stw"},     {Op::STD, "std"},
    {Op::BEQ, "beq"},     {Op::BNE, "bne"},     {Op::BLT, "blt"},
    {Op::BGE, "bge"},     {Op::BLTU, "bltu"},   {Op::BGEU, "bgeu"},
    {Op::JAL, "jal"},     {Op::JALR, "jalr"},   {Op::LUI, "lui"},
    {Op::AUIPC, "auipc"}, {Op::SLT, "slt"},     {Op::SLTU, "sltu"},
    {Op::REM, "rem"},     {Op::REMU, "remu"},   {Op::DIVU, "divu"},
    {Op::MULH, "mulh"},   {Op::FENCE, "fence"}, {Op::ECALL, "ecall"},
    {Op::EBREAK, "ebreak"}, {Op::CSRRW, "csrrw"}, {Op::CSRRS, "csrrs"},
    {Op::CSRRC, "csrrc"},
};

constexpr std::size_t kCaseCount = sizeof(kCases) / sizeof(kCases[0]);

// Every Op has a row above: the test itself cannot silently skip a new opcode.
static_assert(kCaseCount == static_cast<std::size_t>(Op::COUNT),
              "tests/opcode_test.cpp is missing a row for a new Op");

void check_every_opcode_maps_to_its_display_name()
{
  for (std::size_t i = 0; i < kCaseCount; ++i) {
    const char* got = opcode_name(kCases[i].op);
    if (std::strcmp(got, kCases[i].expect) != 0) {
      std::fprintf(stderr, "opcode_name(%zu) = \"%s\", expected \"%s\"\n",
                   static_cast<std::size_t>(kCases[i].op), got, kCases[i].expect);
      assert(false && "opcode_name returned the wrong display name");
    }
  }
}

// Table rows must line up with the enum, not merely be present somewhere.
void check_names_are_indexed_by_enum_value()
{
  for (std::size_t i = 0; i < kCaseCount; ++i) {
    assert(static_cast<std::size_t>(kCases[i].op) == i);
  }
}

// No two opcodes may share a display name.
void check_display_names_are_unique()
{
  for (std::size_t i = 0; i < kCaseCount; ++i) {
    for (std::size_t j = i + 1; j < kCaseCount; ++j) {
      assert(std::strcmp(opcode_name(kCases[i].op),
                         opcode_name(kCases[j].op)) != 0);
    }
  }
}

// The out-of-range guard: a value cast in from outside the enum falls back.
void check_out_of_range_value_falls_back()
{
  assert(std::strcmp(opcode_name(static_cast<Op>(kCaseCount)), "?") == 0);
  assert(std::strcmp(opcode_name(static_cast<Op>(9999)), "?") == 0);
}

}  // namespace

int main()
{
  check_every_opcode_maps_to_its_display_name();
  check_names_are_indexed_by_enum_value();
  check_display_names_are_unique();
  check_out_of_range_value_falls_back();
  return 0;
}
