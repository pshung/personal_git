---
name: gitea-issue-tracker
description: andesim tickets are Gitea issues at gitea.andestech.com/nick/hybrid_sim; use the `tea` CLI (login "andes") with --repo nick/hybrid_sim and --description, not --body.
metadata:
  type: reference
---

"Ticket" for the andesim repo means a **Gitea issue** on the origin remote
`https://gitea.andestech.com/nick/hybrid_sim`. There is no in-repo ticket
directory and no `.gitea/ISSUE_TEMPLATE`; the tracker was empty until
2026-09-06.

Use the **`tea` CLI** (`~/.local/bin/tea`, v0.15.1, installed 2026-09-06).
The login is already configured under the name `andes` (created from the
`~/.git-credentials` password; tea minted its own access token on the server).

```sh
tea issues create --login andes --repo nick/hybrid_sim \
  --title "..." --description "$BODY"
tea issues list --login andes --repo nick/hybrid_sim
```

Two gotchas, both cost a retry:

- The body flag is **`--description` / `-d`**, NOT `--body`.
- **`--repo nick/hybrid_sim` is required.** Auto-detection from the local git
  remote fails ("remote repository required") because the origin URL carries
  userinfo: `https://nick@gitea.andestech.com/nick/hybrid_sim.git`.

The repo has **no labels and no milestones defined**, so don't pass
`--labels`/`--milestone` until some are created. Bodies render GitHub-flavored
markdown (tables work).

Roadmap item IDs (`U10h`, `U11`, `FR-109`, ...) from the `ROADMAP_*.md` files
are the natural ticket titles — see [[andesim-linux-runtime-roadmap]].
