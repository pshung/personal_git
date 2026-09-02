#pragma once

// Single source of truth for the opcode set: enumerator, then display name.
// The Op enum and opcode_name()'s lookup table are both expanded from this one
// list, in this one order, so an opcode can never be added to one and missed in
// the other. To add an opcode, add exactly one line here.
#define OPCODE_LIST(X) \
  X(NOP, "nop")        \
  X(ADD, "add")        \
  X(SUB, "sub")        \
  X(MUL, "mul")        \
  X(DIV, "div")        \
  X(AND, "and")        \
  X(OR, "or")          \
  X(XOR, "xor")        \
  X(SHL, "shl")        \
  X(SHR, "shr")        \
  X(LDB, "ldb")        \
  X(LDH, "ldh")        \
  X(LDW, "ldw")        \
  X(LDD, "ldd")        \
  X(STB, "stb")        \
  X(STH, "sth")        \
  X(STW, "stw")        \
  X(STD, "std")        \
  X(BEQ, "beq")        \
  X(BNE, "bne")        \
  X(BLT, "blt")        \
  X(BGE, "bge")        \
  X(BLTU, "bltu")      \
  X(BGEU, "bgeu")      \
  X(JAL, "jal")        \
  X(JALR, "jalr")      \
  X(LUI, "lui")        \
  X(AUIPC, "auipc")    \
  X(SLT, "slt")        \
  X(SLTU, "sltu")      \
  X(REM, "rem")        \
  X(REMU, "remu")      \
  X(DIVU, "divu")      \
  X(MULH, "mulh")      \
  X(FENCE, "fence")    \
  X(ECALL, "ecall")    \
  X(EBREAK, "ebreak")  \
  X(CSRRW, "csrrw")    \
  X(CSRRS, "csrrs")    \
  X(CSRRC, "csrrc")

enum class Op {
#define OPCODE_ENUMERATOR(enumerator, display_name) enumerator,
  OPCODE_LIST(OPCODE_ENUMERATOR)
#undef OPCODE_ENUMERATOR
};

// Display name of `op`, or "?" if `op` is not a value of the enum.
const char* opcode_name(Op op);
