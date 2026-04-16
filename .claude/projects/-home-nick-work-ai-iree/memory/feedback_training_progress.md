---
name: Print training progress
description: Training loops should print per-epoch loss so user can monitor progress during long runs
type: feedback
---

When running training (modelzoo_ranker, tile_ranker, etc.), the trainer should print per-epoch loss/metrics so the user can monitor progress. Don't wait until the end to print everything — stream progress as it happens.
