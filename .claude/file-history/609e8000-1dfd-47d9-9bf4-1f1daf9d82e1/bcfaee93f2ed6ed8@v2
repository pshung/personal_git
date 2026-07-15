---
name: cpp-runtime-support
description: "C++ works on the andesim runtime since 2026-07-15 (static ctors, libstdc++, dtors at exit); demo/cpp green on all engines"
metadata: 
  node_type: memory
  type: project
  originSessionId: 609e8000-1dfd-47d9-9bf4-1f1daf9d82e1
---

DONE 2026-07-15 (ROADMAP entry 14): the andesim runtime runs C++. Same
two-flag link with g++ (Make.var has CXX). Runtime side is andesim commit
946e2e3: crt0 calls init_mtvec by name (that reference extracts handler.o
from the archive) then walks .init_array via newlib's __libc_init_array;
andesim.ld PROVIDEs the array bounds ABOVE _edata because crt0 zeroes
[_edata, _end) before the walk; specs add crtbegin/crtend (g++ injects
-lstdc++ -lm itself); return-from-main == exit(rc), so static dtors and
atexit run now. Guarded by tests/vplat/test_vplat_cpp.sh.

Non-obvious gotchas: `--trigger pc` resolves symbols by NAME, so C++ ROI
kernels need extern "C" (mangled `_Z7cpp_roiv` is not found); keep
iostream out of demos (static-init work + code size stretch a cycle-mode
boot; printf proves the same thing).

Related: [[l2c-l3c-transport]]
