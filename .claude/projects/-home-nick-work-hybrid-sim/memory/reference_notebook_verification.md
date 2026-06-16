---
name: reference-notebook-verification
description: How to execute docs/*.ipynb headless to verify they work against the live build
metadata: 
  node_type: memory
  type: reference
  originSessionId: d4a79116-3d15-463d-ba8f-92d2069d6222
---

To verify the repo's tutorial notebooks (docs/*.ipynb) actually run:

1. Build must be present (build/andes-sim + verilator/build/sim_* engines). Notebooks
   detect repo root via `(d / "build" / "andes-sim").exists()` and prepend `build/` to PATH.
2. jupyter/nbconvert is NOT installed system-wide. Make a venv that inherits system matplotlib:
   `python3 -m venv --system-site-packages /tmp/nbenv && /tmp/nbenv/bin/pip install nbconvert nbclient ipykernel`
   then `/tmp/nbenv/bin/python -m ipykernel install --user --name nbenv`.
3. Execute (capture ALL failures in one pass): `/tmp/nbenv/bin/jupyter nbconvert --to notebook
   --execute --allow-errors --ExecutePreprocessor.kernel_name=nbenv --output /tmp/out.ipynb <nb>`,
   then parse $out for cells with `output_type=="error"`.
4. Run notebooks SEQUENTIALLY: several chdir to repo root and write shared scratch
   (hello.c, gemm.c, highmem.c) that race if parallel.
5. The source-build (`%%bash`) cells need `HYBRID_TOOLCHAIN`. config.env (gitignored, local)
   must point at the real toolchain or those cells exit 1 with "toolchain missing". See
   [[reference-riscv-toolchain-path]]; correct path is /local/nick/build-ast540.

The 7 notebooks: andes_sim_{tutorial,demo,gemm_tutorial,memory_tutorial,cosim_tutorial,limitations}
+ competition_landscape (pure matplotlib, no sim).
