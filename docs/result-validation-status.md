# Benchmark result validation status

Date: 2026-08-23
Machine-readable receipt: [result-validation-2026-08-23.json](../reports/result-validation-2026-08-23.json)

Receipt file SHA-256: `2eeb60e15239c3f4b3f8201c3ac43b9cb27d692b08bb1f535897789c31212940`
Receipt content self-hash: `17a4cdba943b4a4626a5d460275e720ed65ba61f966302b44cba3f389fdc18d4`

## Scope and interpretation

`benchmark/validate-results.mjs` performs family-specific structural and arithmetic reconciliation for text, executable code, vision, reasoning profiles, loop ablations, and llama.cpp placement receipts. The receipt binds each input by SHA-256 and binds itself with `receiptContentSha256`.

`comparisonEligible: true` means a finished artifact passed its own family contract. It does **not** mean two files used matched settings, hardware residency was controlled, the task suite has external validity, or a routing candidate has passed project-specific admission. Those experimental dispositions are recorded separately below.

## Disposition of key artifacts

| Artifact group | Validator outcome | Evidence disposition | Reason |
|---|---|---|---|
| Isolated Gemma and Granite text screens | Valid, complete, comparison-eligible | **Measured**, structurally **Validated**; usable only as generic task-family evidence | Exact task/repeat coverage, scores, category summaries, timings, and rankings reconcile. No project-specific loop was tested. |
| Dual-resident Gemma and Granite text runs | Valid, complete, comparison-eligible | **Measured**, structurally **Validated**, but excluded as production-placement proof | Simultaneous GPU occupancy was observed, but stable per-endpoint model identity and exclusive placement were not demonstrated; Granite also lacks throughput telemetry. |
| Isolated executable-code finalists | Valid, complete, comparison-eligible | **Measured**, structurally **Validated**; usable as bounded generic code evidence | All request results, recovered-source hashes/byte counts, VM receipts, weighted tests, summaries, and ranking reconcile. This does not cover a full project build or runtime. |
| Configured and isolated vision runs, considered separately | Each valid, complete, comparison-eligible | Each is **Measured** and structurally **Validated**; their 6/6 versus 0/6 Qwen contrast is excluded from causal comparison | Token scale was 4 versus omitted/effective 1, timeout was 180 seconds versus 120 seconds, and model order differed. Every isolated Qwen final text was empty while completion usage reached the task token ceiling. Residency is not an established cause. |
| Native-v1 reasoning-profile run | Complete but invalid and not comparison-eligible | Excluded | Eighteen completed request receipts use a `model_instance_id` ending in `:2` instead of the exact requested identity. The DeepSeek profile separately records 18/18 HTTP 400 failures for the unsupported setting. |
| Two isolated reasoning-profile checkpoints | Valid checkpoints, incomplete, not comparison-eligible | Excluded | `finishedAt` is null; neither checkpoint is a terminal comparison. |
| Specialist loop ablation | Valid, complete, comparison-eligible by internal contract | **Measured** and structurally **Validated**, but excluded as evidence of a successful specialist loop | Direct pass rate was 0.593 and same-model self-refinement fell to 0.192. Cross-specialist pass rate was 0.071 because 11/12 cases failed with HTTP 500 before finalization. This is operational-failure evidence, not a clean capability comparison. |
| llama.cpp placement base and r2 receipts | Valid terminal failure receipts, not comparison-eligible | Excluded | The diagnostic failures reconcile, but failed runs cannot support a placement comparison. |
| llama.cpp placement r3 | Valid, complete, comparison-eligible by internal contract | Excluded as contaminated | Residual external GPU/model activity prevents an isolated placement conclusion. |
| llama.cpp placement r4-clean | Valid, complete, comparison-eligible by internal contract | Excluded as clean-baseline proof | Later cases begin with high residual VRAM, so the filename alone does not establish a clean baseline. |
| llama.cpp placement r5-studio-closed | Valid, complete, comparison-eligible by internal contract | Retained as the cleanest placement diagnostic; no winner | It has only two rounds, the single-GPU generation measurements vary from 6.328 to 1.704 tokens/s, and effective offloaded-layer count is not established. |
| Interrupted all-installed text screen | Valid checkpoint, incomplete, not comparison-eligible | Excluded | Partial observations remain useful for failure diagnosis, not ranking. |

## Routing consequences

- Code and vision numbers may now be called structurally **Validated** when their exact artifact hash is cited.
- Candidate role assignments remain **Inference**, because structural validation does not measure a project-specific routing decision.
- The blocked Qwen vision route remains a **Hypothesis** pending a matched rerun.
- “No benchmark covers this role” is an observed coverage-gap **Inference**, not a proposed mechanism.
- No reasoning-profile, loop-ablation, or placement artifact currently supports a new routing winner. The completed loop artifact specifically provides no measured improvement over direct generation.

LucasAgentStudio's active configuration was not changed by validation.
