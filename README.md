# Local Agent Research

Local Agent Research is an evidence-first workspace for evaluating local language models and designing bounded specialist-agent loops. It focuses on a dual-GPU Windows workstation, but keeps task definitions, raw responses, provenance, and scoring visible so that results can be challenged or reproduced on other hardware.

The practical question is not “Which model wins everything?” It is: which model, prompt contract, tool boundary, and verification loop is reliable enough for each role—and what does that reliability cost in time and memory?

## Status: frontier parity is not established

**This project has not established parity with frontier systems such as GPT Sol or Terra.** A local planner–worker–critic loop may improve decomposable, tool-grounded tasks by spending more time on independent candidates, deterministic checks, and bounded repair. Repeated conversation alone does not make a smaller model frontier-equivalent, and same-model agreement is not independent evidence.

Model recommendations require completed measurements on the relevant task category. A strong screen result is evidence for advancing a model to deeper tests, not a claim of general intelligence or production readiness.

## What belongs here

This repository is the canonical workspace for:

- local-model capability, latency, memory, structured-output, tool-use, and safety measurements;
- specialist-loop architecture, controller contracts, stopping rules, and evidence gates;
- task-specific model-routing recommendations tied to benchmark artifacts;
- source-backed research on agent orchestration and local inference;
- reproducible inventories of historical general-agent research.

Product-specific evidence remains with its product. Sports-play research stays in `SportsPlayLLMResearch`; DZYNE/3D reconstruction experiments stay in `dzyne-vggt-lab`; AnimeRPG, EveryAircraft, RetainageReady, and Junkluggers retain their own acceptance evidence.

## Canonical consolidation

Older general-agent research is not copied wholesale into this repository. The generated [legacy inventory](evidence/legacy-inventory.json) records workspace-relative paths, byte sizes, and SHA-256 digests for the allowlisted historical sources. The large retired append logs remain in place as read-only provenance.

The [consolidation map](docs/consolidation-map.md) defines canonical, archived, and reference paths. New findings belong here; retired standalone research loops must not be resumed or appended merely to extend an old cycle count.

## Reproducibility

### Requirements

- Node.js 22 or newer.
- Python 3.11 or newer for rebuilding the analytical input and executing the dependency-free notebook.
- LM Studio with its CLI and OpenAI-compatible local API available.
- Locally installed model files. This repository does not download models.
- NVIDIA tooling for GPU telemetry when available; missing telemetry is recorded as an error field rather than fabricated.

The runner uses `LMS_PATH` when set and otherwise uses its documented local default. Set `LM_STUDIO_BASE_URL` to change the API address and `BENCH_CASE_TIMEOUT_MS` to change the per-case timeout.

The benchmark runner serially unloads and loads models when model management is enabled. It attempts to restore the initially loaded model after a completed run, but benchmark work should not share LM Studio with production inference.

### Install and inspect

There are currently no third-party runtime dependencies. After installing a compatible Node.js version:

```powershell
npm run inventory
```

This refreshes only the metadata inventory. It does not copy or alter legacy sources.

For immutable GGUF hashes and a dry-run-first comparison of direct llama.cpp single-GPU versus dual-GPU layer placement, see the [model inventory and placement harness](docs/model-inventory-and-placement.md). The current [final model inventory](results/model-inventory-final.json) contains 20 fully hashed GGUF identities with valid headers and zero inventory errors. Inventory completeness does not choose routing winners; capability outputs become evidence only after a completed, reviewed benchmark run.

### Run the screen

```powershell
npm run screen -- --models=openai/gpt-oss-20b,second/model-key
```

The screen runs one repeat of the bounded screening tasks and writes `results/screen-latest.json`. Omitting `--models` asks the runner to enumerate all installed LM Studio language models, which can take substantially longer.

### Run the deeper suite

Use the same candidate set that survived the screen:

```powershell
npm run deep -- --models=openai/gpt-oss-20b,second/model-key
```

The deep command runs the complete task suite three times and writes `results/deep-latest.json`. The raw report records command options, task-suite hash, model metadata, environment, hardware samples, responses, reasoning fields exposed by the server, scores, failures, and timings.

### Validate and summarize

```powershell
npm run validate
npm run summarize
```

Validation dispatches to strict, suite-specific checks for text, executable code, vision, reasoning profiles, loop ablations, and llama.cpp placement receipts. It reconciles case matrices, scores, summaries/rankings, execution receipts, suite hashes, and family-specific identity or telemetry fields. A report is eligible for comparison only when its validation output is valid, `complete` is true, `comparisonEligible` is true, and all warnings and experimental confounds have been reviewed. Structural validation does not make mismatched or contaminated runs externally valid. Summarization then writes a machine-readable summary and model/case CSV files under `results/derived/`.

For one-off or historical artifacts, call the underlying scripts with explicit paths:

```powershell
node benchmark/validate-results.mjs results/example.json
node benchmark/validate-results.mjs --output=reports/result-validation.json results/example.json
node benchmark/summarize-results.mjs results/example.json --output-dir=results/derived-example
```

Validation receipts bind every input file by SHA-256 and include a self-hash. Interrupted checkpoints may be structurally valid while remaining `complete: false` and `comparisonEligible: false`; failed or identity-mismatched runs likewise remain excluded.

### Build a routing audit

The [routing manifest builder](docs/routing-manifest-builder.md) evaluates only model/runtime mappings explicitly listed in a reviewed JSON policy. It binds inventory, benchmark, model, prompt, template, settings, runtime, and schema hashes and writes a companion decision table with score, failure, latency, VRAM, and RAM checks.

The [Lucas Agent Studio project/role routing audit](docs/project-role-routing-audit.md) snapshots every currently registered project role and maps it to measured local-model candidates. The source artifact in this repository remains a proposal. By explicit user request, a separate provisional copy is installed in Lucas Agent Studio: 73 of 83 project roles are routed locally and the 10 roles without sufficient evidence fail closed rather than inheriting a model silently.

```powershell
npm run routing:build
```

The checked-in policy is intentionally unreviewed and has no candidates, so this command currently produces a draft with unresolved profiles. It does not establish model winners. Production consumers must require `validated` status.

## Evidence labels

Research notes and recommendations use these labels:

| Label | Meaning |
|---|---|
| **Measured** | Produced by a recorded benchmark or deterministic inspection with raw evidence retained. |
| **Validated** | Passed the repository’s structural and reconciliation checks. Validation does not by itself prove external validity. |
| **Source-backed** | Supported by a linked first-party document, repository, paper, or other identified source. |
| **Historical** | Preserved from a legacy loop or runtime and not assumed to describe the current system. |
| **Inference** | A recommendation or conclusion derived from stated evidence rather than directly measured. |
| **Hypothesis** | A testable proposal that has not yet been measured. |

Claims should name their artifact or source, hardware and model configuration when relevant, task-suite version, and important limitations. “Settled,” “completed,” or “agents agreed” are execution states—not quality evidence.

## Repository map

```text
benchmark/   Task suite, benchmark runner, validator, and summarizer
docs/        Architecture research, operating guidance, and consolidation policy
evidence/    Curated source packages and metadata-only legacy inventory
policies/    Human-reviewed role/model/runtime mappings (the checked-in example is draft-only)
reports/     Generated routing manifests, decision tables, and analytical reports
results/     Raw benchmark reports and generated derived tables
schemas/     Strict controller, evidence, verification, and routing contracts
scripts/     Research maintenance and provenance utilities
tests/       Deterministic scoring, safety, inventory, and routing tests with fixtures
```

Start with the [architecture landscape](docs/architecture-landscape.md), [hardware and model shortlist](docs/hardware-and-model-shortlist.md), and [local-loop operating playbook](docs/local-loop-operating-playbook.md). The benchmark implementation and scoring contracts are in [benchmark/](benchmark/).

## Results

The answer-first [technical report](reports/local-specialist-loop-findings.html), its [reviewed evidence package](reports/local-specialist-loop-findings.evidence.json), and the executable [analysis notebook](notebooks/benchmark-results-analysis.ipynb) are the best entry points. The final suite-aware [validation receipt](reports/result-validation-2026-08-23-final.json) covers 25 benchmark artifacts: 24 are structurally valid, 20 complete, and 17 comparison-eligible. The report applies stricter manual confound review and uses nine clean artifacts.

| Task | Current evidence-led choice | Measured result | Important limit |
|---|---|---:|---|
| Planning / synthesis | Gemma 4 E4B | 88.6% text screen; 67.94 generated tok/s | Provisional role inference, not a general-intelligence claim |
| Research / grounding / tools | Granite 4.1 8B | 86.7% text screen; 26.61 generated tok/s | Strong breadth, but 0% on the suite's critique category |
| Default coding | GPT-OSS 20B | 88.0%; 48/52 executable checks; 36.51 tok/s | Repository-specific tests remain the acceptance authority |
| Slow coding escalation | Devstral Small 2 24B | 85.5% code; 96.0% text | Much slower; reserve for deterministic failure or high complexity |
| Vision | Unresolved tie | GLM-4.6V-Flash, Qwen3.5 9B, and Gemma 4 12B each scored 6/6 | Clean isolated latency/memory tie-break still required |
| Reasoning specialist | Unresolved | No model admitted | Reasoning-profile runs were incomplete or identity-invalid |

The clean loop ablation is the key architectural result. Direct Gemma solving scored `0.5929`; a three-call Gemma→Granite→Gemma cross-specialist loop scored `0.5869`; same-model self-refinement fell to `0.1921`. The cross-specialist method fixed one code answer but damaged a planning answer and used three times as many calls. The operating rule is therefore **deterministic check first, then selective different-family escalation for a named defect**—not automatic debate.

Direct llama.cpp placement also showed that using both GPUs can be worthwhile for a large escalation model: Devstral's clean 5:4 layer split generated 14.56–14.57 tok/s, versus 6.33 and 1.70 tok/s in the two RTX-3070-only rounds. This is a placement result for that quantized model and runtime, not a universal dual-GPU speedup.

The [final model inventory](results/model-inventory-final.json) records 20 valid GGUF files totaling 105,322,544,512 bytes with immutable hashes and zero inventory errors. Incomplete Qwen3.6 27B Q2 runs, identity-invalid reasoning runs, co-resident vision diagnostics, endpoint-failed loops, smoke tests, and superseded screens remain checked in for audit but are excluded from recommendations.

No matched Sol or Terra baseline was run, so frontier parity is explicitly unestablished. The local design aims for better task reliability by trading latency for decomposition, tools, independent families, durable state, and deterministic verification.

## License

Code and original documentation are available under the [MIT License](LICENSE). Third-party models, papers, tools, and imported evidence retain their respective licenses and terms.
