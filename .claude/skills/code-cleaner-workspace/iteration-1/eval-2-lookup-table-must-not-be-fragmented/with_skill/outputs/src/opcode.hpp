#pragma once

// Single source of truth for the instruction set: one row per opcode, holding
// the enumerator and its display name. Both the Op enum below and the lookup
// table in opcode.cpp are generated from this list, so they cannot drift apart.
// Adding an instruction is one line here and nothing else.
//
// Rows are in enum order; append new opcodes at the end to keep existing
// enumerator values stable.
#define OPCODE_LIST(X)  \
  X(NOP,   "nop")       \
  X(ADD,   "add")       \
  X(SUB,   "sub")       \
  X(MUL,   "mul")       \
  X(DIV,   "div")       \
  X(AND,   "and")       \
  X(OR,    "or")        \
  X(XOR,   "xor")       \
  X(SHL,   "shl")       \
  X(SHR,   "shr")       \
  X(LDB,   "ldb")       \
  X(LDH,   "ldh")       \
  X(LDW,   "ldw")       \
  X(LDD,   "ldd")       \
  X(STB,   "stb")       \
  X(STH,   "sth")       \
  X(STW,   "stw")       \
  X(STD,   "std")       \
  X(BEQ,   "beq")       \
  X(BNE,   "bne")       \
  X(BLT,   "blt")       \
  X(BGE,   "bge")       \
  X(BLTU,  "bltu")      \
  X(BGEU,  "bgeu")      \
  X(JAL,   "jal")       \
  X(JALR,  "jalr")      \
  X(LUI,   "lui")       \
  X(AUIPC, "auipc")     \
  X(SLT,   "slt")       \
  X(SLTU,  "sltu")      \
  X(REM,   "rem")       \
  X(REMU,  "remu")      \
  X(DIVU,  "divu")      \
  X(MULH,  "mulh")      \
  X(FENCE, "fence")     \
  X(ECALL, "ecall")     \
  X(EBREAK, "ebreak")   \
  X(CSRRW, "csrrw")     \
  X(CSRRS, "csrrs")     \
  X(CSRRC, "csrrc")

enum class Op {
#define OPCODE_ENUMERATOR(name, text) name,
  OPCODE_LIST(OPCODE_ENUMERATOR)
#undef OPCODE_ENUMERATOR
  COUNT  // sentinel: number of opcodes, not an instruction
};

// Display name of op, or "?" if op is not a valid Op value.
const char* opcode_name(Op op);
