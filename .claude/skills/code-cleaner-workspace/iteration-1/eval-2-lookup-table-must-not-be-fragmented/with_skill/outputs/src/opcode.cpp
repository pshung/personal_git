#include "opcode.hpp"

#include <cstddef>

namespace {

// Indexed by the Op value. Generated from OPCODE_LIST, the same list that
// generates the enum, so a row can never go missing or land out of order.
constexpr const char* kOpcodeNames[] = {
#define OPCODE_NAME_ROW(name, text) text,
    OPCODE_LIST(OPCODE_NAME_ROW)
#undef OPCODE_NAME_ROW
};

static_assert(sizeof(kOpcodeNames) / sizeof(kOpcodeNames[0]) ==
                  static_cast<std::size_t>(Op::COUNT),
              "opcode name table is out of sync with the Op enum");

}  // namespace

const char* opcode_name(Op op)
{
  const auto index = static_cast<std::size_t>(op);
  if (index >= static_cast<std::size_t>(Op::COUNT)) {
    return "?";
  }
  return kOpcodeNames[index];
}
