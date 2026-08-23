# Local Agent Research agent instructions

These instructions apply to the entire repository.

## Mission and authority

This is the canonical repository for general local-agent research: local-model benchmarks, specialist-loop architecture, controller protocols, orchestration evidence, and measured role routing. Add new general-agent findings here. Do not create or revive a parallel general-agent research loop elsewhere.

Product and domain research remains separate. Sports-play research belongs in `SportsPlayLLMResearch`; DZYNE/3D reconstruction belongs in `dzyne-vggt-lab`; product projects such as AnimeRPG, EveryAircraft, RetainageReady, and Junkluggers retain their own requirements and acceptance evidence. They may consume a routing recommendation without moving their domain evidence here.

## Evidence language

Use these labels exactly:

- **Measured:** produced by a recorded benchmark or deterministic inspection with raw evidence retained.
- **Validated:** passed repository structural/reconciliation checks; this does not prove external validity.
- **Source-backed:** supported by an identified first-party source, repository, or paper.
- **Historical:** preserved legacy evidence that is not assumed current.
- **Inference:** conclusion derived from named evidence rather than directly measured.
- **Hypothesis:** testable proposal not yet measured.

Never use model consensus, loop count, a successful parse, or “agents agreed” as quality evidence. Do not claim parity with GPT Sol, Terra, or another frontier system without a separately defined, controlled, matched comparison. This repository has not established frontier parity.

## Benchmark evidence contract

Every result used for comparison or routing must retain:

- unedited raw model outputs, reasoning fields exposed by the runtime, tool calls, errors, scores, and timings;
- exact task-suite version and SHA-256 hash;
- hardware/OS/runtime identity and relevant GPU/RAM telemetry;
- exact model identifier/artifact, parameterization, quantization, and file/hash when available;
- context length, output limit, prompt and chat-template identity/hash, tool/schema contract, and runtime settings;
- per-case and run timeout values;
- requested and completed repeat counts, seeds when available, interruptions, and missing cases;
- validation status, warnings, limitations, and provenance for derived summaries.

Do not overwrite or hand-edit raw reports. Write corrected or derived artifacts separately and retain lineage to the raw input. Interrupted/incomplete runs are diagnostic evidence, not leaderboards. Run the canonical validator before comparison; see [the benchmark implementation](benchmark/) and [current results](results/).

## Routing and verification

- Route by measured role/category performance, not model size, vendor claims, or preference.
- A production routing manifest must validate against [the routing-manifest schema](schemas/routing-manifest.schema.json), reference a completed validated benchmark snapshot, and contain exact model/quant/template/runtime hashes. No unmeasured winner or fallback model may be inserted.
- If no model meets a role threshold, leave the role unresolved and block/escalate; do not silently choose the largest model.
- Every accepted worker result requires an independent verifier execution. Run deterministic checks first. The verifier must use a clean context, must not be the producing attempt, and must see the original constraints. When judgment is model-based, use a separately measured verifier profile—preferably a competent different family—and record any remaining correlation limitation.
- The controller, not an LLM, owns acceptance, retries, leases, side-effect approval, and stopping. Follow [the operating playbook](docs/local-loop-operating-playbook.md) and [protocol schemas](schemas/README.md).

## Safety, privacy, and legacy state

- Treat legacy loops as read-only provenance. Do not resume, append, increment, or republish retired loop state. Use [the consolidation map](docs/consolidation-map.md) and metadata inventory instead.
- Never commit or publish secrets, API keys, tokens, cookies, browser/session state, private prompts, user data, model-provider credentials, or plaintext secret-bearing logs.
- Never copy or publish runtime databases, LM Studio/application databases, daemon state, task queues, caches, lock files, or unrelated product telemetry as research evidence. Extract the minimum non-secret measurement into a new provenance-linked artifact.
- Do not publish model weights or third-party artifacts whose license does not permit redistribution.
- Keep writes inside this repository unless the user explicitly places another project in scope. External publication or other material side effects require explicit authority and independent verification.

## Canonical references

- [Repository overview and evidence policy](README.md)
- [Local-loop operating playbook](docs/local-loop-operating-playbook.md)
- [Machine-readable protocol schemas](schemas/README.md)
- [General-agent consolidation map](docs/consolidation-map.md)
- [Architecture landscape](docs/architecture-landscape.md)
- [Hardware and model shortlist](docs/hardware-and-model-shortlist.md)
- [Raw and derived results area](results/)

If documentation and a raw artifact disagree, preserve both, report the conflict, and resolve it through a new validated measurement. Do not rewrite history to make the evidence look settled.
