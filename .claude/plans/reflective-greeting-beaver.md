# Plan: Improve ModelzooRanker OPA and Top-5 Error

## Context
Current metrics: OPA=0.6579, top-5 error=0.8876 on test set (ResNet-50, DenseNet). Goal is to improve both through training fixes, feature engineering, and architecture changes. Changes should be incremental, testable, and follow TDD.

## Phase 1: Training Quick Wins

### 1A. Align top_k loss with evaluation (top_k=3 → 5)
Loss concentrates gradient on top-3 but we evaluate top-5 error. Change default `top_k=5`.
- `script/modelzoo_ranker/train.py` — change default in `train_and_evaluate` signature + argparse
- `script/modelzoo_ranker/training/trainer.py` — change default in `train()` signature

### 1B. Add LR warmup
No warmup currently; immediate 1e-3 may overshoot. Add linear warmup for first 10 epochs using `SequentialLR(LinearLR + CosineAnnealingLR)`.
- `script/modelzoo_ranker/training/trainer.py` — replace scheduler with warmup chain, add `warmup_epochs` param
- `script/modelzoo_ranker/train.py` — expose `--warmup-epochs` CLI arg

### 1C. Weight groups by log(group_size) in loss
Groups with 50 configs provide more ranking info than groups with 2. Weight each group's loss by `log(size)`.
- `script/modelzoo_ranker/model/loss.py` — add optional `sizes` param, apply `log(size)` weighting
- `script/modelzoo_ranker/training/trainer.py` — pass `batch['sizes']` to loss

### 1D. Increase patience/epochs defaults
Best epoch 67/98 with patience=30 may stop too early. Change defaults: `patience=50`, `max_epochs=300`.
- `script/modelzoo_ranker/train.py` — change defaults

## Phase 2: Feature Engineering

### 2A. Add reduction dimension coverage to Feature B
Currently only L0/L1 parallel coverage (6 features). Add:
- L0_reduction_coverage[2]: `tile_L0[red_dim] / shape[red_dim]`
- L1_reduction_coverage[2]: same for L1
- FEATURE_B_DIM: 52 → 56

Files:
- `script/modelzoo_ranker/data/features.py` — extend `compute_feature_b`, update `FEATURE_B_DIM`
- Tests first (TDD red→green)

### 2B. Add tile-shape interaction features
Model sees op identity + tile config independently. Add explicit interactions:
- `log_register_tile`: log1p(product of L0 non-zero tiles) — register pressure proxy
- `parallel_tile_ratio`: product(L0 parallel tiles) / product(parallel shape dims)
- `reduction_tile_ratio`: product(L0 reduction tiles) / product(reduction shape dims)
- FEATURE_B_DIM: 56 → 59

Files:
- `script/modelzoo_ranker/data/features.py` — add interaction features
- Tests first (TDD red→green)

## Phase 3: Architecture

### 3A. Add residual (skip) connection
Skip connection from post-BatchNorm input to second hidden layer output. Helps gradient flow.
```
x → BN → Linear(in,128) → ReLU → Drop → Linear(128,64) → ReLU → Drop
                                                              + Linear(in,64) [skip]
                                                              → Linear(64,1)
```
- `script/modelzoo_ranker/model/ranker.py` — add skip projection + residual add

## Execution Order
1. 1A (top_k=5) — trivial, immediate alignment
2. 1B (warmup) — small, well-understood
3. 1C (group weighting) — principled improvement
4. 1D (patience/epochs) — trivial defaults
5. 2A (reduction coverage) — highest-impact feature
6. 2B (tile-shape interactions) — builds on 2A
7. 3A (residual connection) — moderate architecture improvement

Each step: write test → implement → verify → commit separately.

## Verification
After all changes, retrain and compare:
```sh
cd script && python3 -m modelzoo_ranker.train ../dataset_modelzoo/ \
    --zoo-dir /local/nick/AutoIREE_zoo/models \
    --epochs 300 --batch-size 16 --lr 1e-3 --patience 50 --top-k 5 \
    --warmup-epochs 10 \
    --val-models YOLOv8n MobileNet_v3_int8 \
    --test-models ResNet-50 DenseNet \
    -o ../tmp/modelzoo_ranker_v3/
```
Compare `test_metrics.json` v3 vs v2: OPA (target >0.70), top-5 error (target >0.92).
