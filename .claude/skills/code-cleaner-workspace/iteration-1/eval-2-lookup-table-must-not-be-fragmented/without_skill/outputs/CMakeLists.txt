cmake_minimum_required(VERSION 3.20)
project(opcodes CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
enable_testing()

option(OPCODES_COVERAGE "Build with gcov instrumentation" OFF)

add_executable(opcode_test tests/opcode_test.cpp src/opcode.cpp)
target_include_directories(opcode_test PRIVATE src)
target_compile_options(opcode_test PRIVATE -Wall -Wextra)

if(OPCODES_COVERAGE)
  target_compile_options(opcode_test PRIVATE --coverage -O0 -g)
  target_link_options(opcode_test PRIVATE --coverage)
endif()

add_test(NAME opcode_test COMMAND opcode_test)
