---
name: user-image-verification-dir
description: /home/nick/work/build_andesim is the clean-room "user with only the image" directory used to QA andesim release tickets.
metadata:
  type: project
---

`/home/nick/work/build_andesim` is a deliberate stand-in for **a user who has
nothing but the AndeSim container image** — no `build/andesim`, no
`config.env`, no source tree. Nick keeps it to QA the v0.1.0 release tickets
(#20, #21, #23, #24); it holds only `Containerfile`, `VERSION`,
`scripts/build_image.sh`, `image-build.log`, a couple of fixture ELFs, and
(since 2026-09-09) the entry point `andesim` + `scripts/run_in_container.sh`.

When a release ticket says "verify your result", run the ticket's QA steps
**from that directory**, not from `/home/nick/work/andesim` — the point is
that a host with no local driver still works. `podman images` there shows the
built `localhost/andesim:v0.1.0`.

To fake "no image has been built" without a rebuild (hours of Verilator):

```sh
ID=$(podman image inspect andesim:v0.1.0 --format '{{.Id}}')
podman untag andesim:v0.1.0     # ... run the check ...
podman tag "$ID" andesim:v0.1.0
```

Related: [[gitea-issue-tracker]], [[vsim-submodule-pins-must-be-pushed]].
