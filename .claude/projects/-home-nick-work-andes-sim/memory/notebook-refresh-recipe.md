---
name: notebook-refresh-recipe
description: How to re-execute docs/*.ipynb against the current andesim binary
metadata: 
  node_type: memory
  type: project
  originSessionId: ae5483e5-a453-4fa7-9aee-2e7fac3a20e4
---

To regenerate the `docs/*.ipynb` tutorial outputs against the freshly-built
`andesim` (e.g. after a CLI change), the notebooks' declared `python3` kernel is
usually unregistered. Recipe that worked:

1. `python3 -m pip install ipykernel nbconvert matplotlib` (matplotlib only for
   `competition_landscape.ipynb`).
2. `python3 -m ipykernel install --user --name andesim-nb` -- a throwaway kernel
   (the notebooks keep their portable `python3` kernelspec; override at run time).
3. Build prerequisites first: qemu+vsim are usually present, but the plugin
   (`scripts/build_all.sh plugin`) and fixtures (`make -C tests/fixtures`) often
   are not -- a missing plugin makes every hybrid cell fail.
4. Execute from the repo root with PATH including `build/`:
   `python3 -m nbconvert --to notebook --execute --inplace
    --ExecutePreprocessor.kernel_name=andesim-nb
    --ExecutePreprocessor.timeout=900 docs/<nb>.ipynb`

Gotchas: `andes_sim_demo.ipynb` has gdb/ICEman `%%bash` cells that block headless
-- tag them `skip-execution` in cell `metadata.tags` (nbclient honors it) to keep
their human-generated outputs. The runtime tutorial wrote throwaway sources to
shared `/tmp/hello.c` etc., which collide with other users' files -- it now uses
`/tmp/andesim_*`. See [[zsh-noclobber-overwrite]] for the `>|` shell gotcha.
