# GGUF inventory and llama.cpp placement harness

Status: **Hypothesis** prepared for measurement. No GPU workload was launched while this harness was added, and it declares no model or placement winner.

## What it records

`scripts/inventory-models.mjs` recursively finds regular `.gguf` files under explicit roots, streams a SHA-256 over every artifact, validates the fixed [GGUF header](https://github.com/ggml-org/ggml/blob/master/docs/gguf.md), detects artifacts that change during hashing, and derives LM Studio's filesystem identity (`publisher/repository/artifact`) when that root type is selected. Absolute model-root paths are omitted, symbolic links are not followed, recognized credential-shaped strings are redacted, and no LM Studio database, daemon state, or model weights are copied.

`benchmark/run-llamacpp-placement.mjs` prepares an alternating comparison between:

- one explicit llama.cpp device with `split-mode=none`; and
- two explicit devices with `split-mode=layer` and caller-supplied tensor-split proportions.

It uses `llama-bench` directly, one process per placement and round. A receipt retains the model and executable hashes, GGUF header identity, exact safe command arguments, suite hash, bounded help/device capability probes, timeouts, requested/completed rounds, raw process streams with pre-redaction hashes, parsed llama-bench JSON, and sampled GPU UUID/name/driver/VRAM/utilization/temperature/power data. Alternating A/B order makes order and thermal bias visible; it does not remove them.

The flags are **Source-backed** by the current official [llama-bench source](https://github.com/ggml-org/llama.cpp/blob/master/tools/llama-bench/llama-bench.cpp) and [llama.cpp CLI documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md), inspected 2026-08-23. Because upstream changes, each run hashes the executable and captures bounded `--help` and `--list-devices` receipts before loading a model.

Compatibility rule: do not call `llama-bench --version`. In official build b10566 that argument starts the default benchmark instead of returning metadata. The harness uses the executable SHA-256 as the authoritative build identity and accepts a help probe only when it advertises every required flag. Build b10566 can also print valid devices and exit `1`; the device probe accepts exit `0` or `1` only when every requested identifier is present and no timeout, abort, spawn error, or output overrun occurred.

## Inventory

First validate only the selected root. This performs no hashing and writes nothing:

```powershell
npm run inventory:models -- --lm-studio-default --dry-run
```

Then choose a new output name and create the inventory. Hashing large model files is disk-intensive, so do not overlap it with a benchmark whose timings matter.

```powershell
npm run inventory:models -- --lm-studio-default --output=results/model-inventory-2026-08-23.json
```

Additional roots use a non-secret label. The absolute root is read but not persisted:

```powershell
npm run inventory:models -- --root=archive=D:\Models --output=results/model-inventory-archive-2026-08-23.json
```

Output files are created with exclusive-write semantics and are never overwritten.

### Current final inventory

The [final model inventory](../results/model-inventory-final.json) is **Measured** metadata generated on 2026-08-23 from the conventional LM Studio root. It records 20 GGUF artifacts totaling 105,322,544,512 bytes. All 20 files have valid GGUF headers and SHA-256 identities; the single root is `present`, and the report records zero errors. Its inventory self-hash is `f96b4b7ff66df8c3ea9df99decca11dac25b861af253ed551dde53396921aefc`; the complete JSON file hash pinned by the draft routing policy is `7ef11bb083b2dbb046248fad3fa6d7c2f49228f5fa3614972fe3b11adc5c5bb7`.

This validates artifact identity and inventory completeness for that root. It does not measure model quality, latency, runtime fit, or routing eligibility.

## Placement plan

Use the device names printed by the exact `llama-bench --list-devices` build, not assumed CUDA ordinals. Map those names separately to the `nvidia-smi` indices used for telemetry. Tensor-split values are proportions, not a measured recommendation.

For a model too large to offload fully to the single GPU, optionally supply both `--fit-target=<MiB>` and `--fit-ctx=<tokens>`. The same reserve margin and minimum context are passed to both placements; llama-bench may therefore choose fewer GPU layers for the single-device case and more for the two-device case. The actual offloaded layer count in llama-bench's raw JSON—not the requested maximum—must be used when interpreting the comparison. Supplying only one fit option is rejected.

Running without the two execution switches hashes and validates the selected executable/model and prints a plan, but starts no llama.cpp process or telemetry:

```powershell
npm run bench:placement -- `
  --llama-bench=C:\llama.cpp\llama-bench.exe `
  --model=D:\Models\publisher\model\model-Q4_K_M.gguf `
  --model-id=publisher/model:Q4_K_M `
  --single-device=CUDA0 `
  --dual-devices=CUDA0,CUDA1 `
  --nvidia-indices=0,1 `
  --tensor-split=1,1 `
  --fit-target=1024 `
  --fit-ctx=4096
```

Only after other inference is stopped and the plan is reviewed, add both `--execute` and `--acknowledge-gpu-workload`, plus a new receipt path inside this repository:

```powershell
npm run bench:placement -- `
  --llama-bench=C:\llama.cpp\llama-bench.exe `
  --model=D:\Models\publisher\model\model-Q4_K_M.gguf `
  --model-id=publisher/model:Q4_K_M `
  --single-device=CUDA0 `
  --dual-devices=CUDA0,CUDA1 `
  --nvidia-indices=0,1 `
  --tensor-split=1,1 `
  --fit-target=1024 `
  --fit-ctx=4096 `
  --output=results/llamacpp-placement-model-q4-2026-08-23.json `
  --execute --acknowledge-gpu-workload
```

The runner fails closed if requested devices are absent, the GGUF header is invalid, an output/partial receipt already exists, telemetry or processes time out, or output exceeds its bound. A failed or interrupted receipt remains diagnostic evidence, not a leaderboard. Run multiple models only as separate immutable receipts, and compare them only after checking exact hashes and hardware conditions.
