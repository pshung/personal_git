#include "opcode.hpp"

#include <cstddef>
#include <iterator>

namespace {

// Expanded from the same OPCODE_LIST as the Op enum, so entry N is always the
// name of enumerator N. The mapping is data, not control flow: one contiguous
// table, indexed directly.
constexpr const char* kOpcodeNames[] = {
#define OPCODE_NAME(enumerator, display_name) display_name,
    OPCODE_LIST(OPCODE_NAME)
#undef OPCODE_NAME
};

}  // namespace

const char* opcode_name(Op op)
{
  const std::size_t index = static_cast<std::size_t>(op);
  if (index >= std::size(kOpcodeNames)) {
    return "?";
  }
  return kOpcodeNames[index];
}
