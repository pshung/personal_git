#include "transport_csrs.hpp"
#include <fstream>
#include <iterator>
#include <cstdio>
int main(int argc, char** argv) {
  std::ifstream f(argv[1], std::ios::binary);
  std::string csv((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
  auto a = andes_sim::transported_csr_addrs(csv);
  std::printf("%zu\n", a.size());
  for (auto& s : a) std::printf("%s\n", s.c_str());
}
