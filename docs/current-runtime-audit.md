# Current Company Runtime audit

Snapshot: **2026-08-23 (America/New_York)**

Scope: the general local-agent research runtime and its associated artifact roots
Evidence status: sanitized transcription of verified runtime inspection; **not** a model benchmark or routing decision

## Outcome

**Historical baseline:** The supported execution authority was one SQLite-backed, event-driven Company Runtime, and the matching SQL project, `agentic-ai-research`, was stopped with no active work. The baseline inspection found missing endpoint affinity, bypassable endpoint admission, conflated model lifecycle states, and one unused GPU.

**Measured post-migration:** The runtime now loads an explicitly opted-in provisional route file, exposes two named local endpoints, pins every admitted request, and fails closed for unmapped roles. The public research artifact remains a proposal; this is a separate installed configuration enabled by the user's explicit request.

**Historical:** Cron, StudioLoop, ProjectLoop, and watchdog-based authorities are retired. Their artifacts remain provenance only and must not be resumed.

**Inference:** Migration should preserve the single runtime authority while making endpoint identity and model lifecycle state explicit. It must not restart the stopped project, revive a legacy loop, or select a role/model winner. A model becomes route-eligible only after reproducible local measurements and independent verification.

## Post-migration verification

This section supersedes the operational defects recorded in baseline findings 3, 4, and 6 while preserving those findings as provenance.

**Measured:** Lucas Agent Studio was restarted from source with `STUDIO_ENABLE_LOCAL_MODEL_ROUTE_CONFIG=1`; the same opt-in is persisted in the user's environment for future Studio launches. The installed route file is revision `local-agent-research-provisional-2026-08-23-r2` and is explicitly marked runtime-enabled. Merely placing the proposal in the data directory remains insufficient to activate it.

**Measured:** The live API returned 83 project agents: 73 provisionally routed and 10 unresolved/fail-closed. The admitted model counts were:

| Model | Provisionally routed roles | Primary use |
|---|---:|---|
| Gemma 4 E4B | 32 | planning, synthesis, and selected QA |
| Granite 4.1 8B | 30 | research, grounding, tools, and selected oversight |
| GPT-OSS 20B | 9 | coding |
| Qwen3.5 9B | 2 | provisional vision routing pending a clean tie-break |

The 10 unmapped roles do not inherit a hosted or local default. Registry construction remains available for inspection, but inference raises a typed unresolved-route error.

**Measured:** The live endpoint topology is:

| Endpoint | Hardware/runtime | Contract |
|---|---|---|
| `gpu0-lmstudio-timesliced` | RTX 3070; Bionic/LM Studio-compatible API | Gemma, GPT-OSS, Devstral, or Qwen; exactly one LLM resident; `parallel=1`; verify before and after inference |
| `gpu1-llamacpp-granite-static` | GTX 1080; llama.cpp b10566 | Granite resident at 8,192 context; one static grounding/tool lane |

**Measured:** Bionic 1.0.1 ignored an explicit `context_length=8192` through both its native load API and `lms load`, choosing 115,712 for the observed Gemma instance. The controller therefore treats context as runtime-managed and records the observed value, while continuing to enforce sole residency and `parallel=1`. It does not claim that the requested context was honored.

**Measured:** The general `agentic-ai-research` Company project remains stopped. The desired project set was restored to `dzyne`, `loop-ops-supervisor`, `sports-play-llm`, `every-aircraft`, `internships`, and `animerpg`; no legacy general-research scheduler was revived.

**Inference:** These checks establish routing and fail-closed control behavior, not production model admission or frontier parity. The schema-v1 routes remain provisional until project-specific held-out gates are reviewed.

## Evidence boundary and source types

The live operational database, full logs, secrets, and runtime configuration are intentionally not copied into this repository. The current-state claims below were measured on the snapshot date using these source types:

| Source type | Facts supported | Repository handling |
|---|---|---|
| Deterministic SQLite queries | Runtime/project state, task and run counts, research-agent records, active-work count | Only the non-secret aggregate findings are recorded here. The runtime database remains outside the repository. |
| Runtime source and configuration inspection | Supported authority, retired entry points, endpoint-pool use, `localEndpointId` handling, implicit fallback, model-list semantics | Summarized behavior only; no credentials or machine-specific secrets. |
| Local API response inspection | `/api/models` catalog/admission conflation | Counts and state semantics only. |
| Sanitized Company Runtime history/error inspection | `gpt-oss` protocol, timeout, and context failures | Failure classes only; no prompts, private task content, or raw logs. |
| GPU/process telemetry | LM Studio placement on the RTX 3070 and idle GTX 1080 | Point-in-time placement only, not a performance result. |
| Metadata-first artifact inventory | Four overlapping historical research roots and their provenance | Paths, sizes, and hashes are indexed; source contents are not duplicated. See the [consolidation map](consolidation-map.md) and [legacy inventory](../evidence/legacy-inventory.json). |

The labels **Measured**, **Historical**, **Inference**, and **Hypothesis** follow the [repository evidence contract](../AGENTS.md). No finding in this audit is a **Validated** routing result.

## Baseline findings and implications

### 1. One authority, stopped research project

**Measured:** One supported SQLite-backed, event-driven Company Runtime is the current orchestration authority.

**Historical:** The cron, StudioLoop, ProjectLoop, and watchdog authorities are retired. They are not fallback schedulers.

**Measured:** The SQL runtime has one matching general-research project ID, `agentic-ai-research`, with this snapshot state:

| Field | Value |
|---|---:|
| State | `stopped` |
| Active work | 0 |
| Task records | 229 |
| Run records | 200 |

**Inference:** The record counts establish accumulated runtime history, not completion, correctness, or model quality. Migration must leave this project stopped until an operator explicitly starts a new, canonical run.

### 2. Four historical artifact roots are consolidated metadata-first

**Historical:** General-agent research had overlapping material in four LucasAgentStudio roots:

1. `projects/LucasAgentStudio/data/agentic-ai-research/`
2. `projects/LucasAgentStudio/data/research-loops/agent-studio/`
3. `projects/LucasAgentStudio/data/research-loops/agent-studio-competing/`
4. `projects/LucasAgentStudio/data/research-loops/agentic-ai-research/`

**Measured:** Their provenance is consolidated into this repository through metadata and hashes rather than copied runtime state. The source roots remain read-only historical evidence.

**Inference:** New general-agent research belongs in this repository. A migration may reference an inventoried artifact by path and digest, but it must not append to an old root, import a runtime database, or treat legacy agent settlement counts as evaluation scores.

### 3. Endpoint affinity is declared but not enforced

**Measured:** The three current research agents are hosted as `Luna`; none has a `localEndpointId` affinity.

**Measured:** A multi-endpoint pool exists, but the active execution path ignores `localEndpointId`. Duplicate implicit fallback behavior sends otherwise unresolved work to `http://127.0.0.1:1234`, bypassing the intended endpoint whitelist.

**Inference:** The configured pool is not an effective routing boundary. A run cannot prove which admitted endpoint, GPU, runtime settings, or loaded model actually handled an attempt merely from the agent assignment.

Migration constraint: endpoint resolution must fail closed. Every local attempt must resolve an explicit, enabled endpoint identity before dispatch; that identity must be written to the attempt record and receipts. Missing, unknown, unhealthy, or non-admitted endpoint IDs must block dispatch. There must be no implicit URL fallback.

### 4. Installed, admitted, loaded, healthy, and eligible are different states

**Measured:** `/api/models` conflates 13 installed catalog entries with the admitted `gpt-oss` runtime model. The interface does not preserve the lifecycle distinction needed for safe routing.

**Inference:** Catalog membership is not permission to run, and admission is not evidence of fitness. The control plane needs separate representations for:

- `installed`: artifact present in the local catalog;
- `admitted`: explicitly allowed by runtime policy;
- `loaded`: currently served by a named endpoint;
- `healthy`: passed the endpoint's current health/protocol probe; and
- `role_eligible`: passed the measured thresholds in a validated routing manifest.

An API response should expose these states explicitly and must not synthesize one undifferentiated model list.

### 5. `gpt-oss` history is diagnostic, not a verdict

**Measured:** Company Runtime history contains `gpt-oss` failures in three classes: protocol/response-contract failures, timeouts, and context-limit failures.

**Inference:** These failures show that the observed runtime path was unreliable under its recorded conditions. They do not isolate intrinsic model capability from prompt template, protocol adapter, context allocation, timeout, quantization, or endpoint configuration.

Migration constraint: retain these cases as regression fixtures. A future claim must record the raw output, suite and task hashes, hardware, exact model artifact and quantization, context, template, runtime settings, timeout, and repeats. A changed adapter or limit creates a new measured condition; it does not rewrite the historical result.

### 6. The second GPU is available but unused by LM Studio

**Measured:** At the snapshot, LM Studio was using only the RTX 3070. The GTX 1080 was idle.

**Hypothesis:** Explicit per-endpoint GPU affinity could use the GTX 1080 for a second specialist lane or bounded parallel work. This may improve throughput or isolation, but it has not been measured here and could be constrained by model fit, runtime support, memory, thermals, or inter-endpoint contention.

**Inference:** Migration should make hardware affinity observable without requiring both GPUs to be busy. An idle GPU is not itself a defect, and this snapshot does not establish which model or role belongs on either device.

## Required migration constraints

1. **Keep one mutating authority.** Company Runtime remains the only scheduler/state-transition owner. Retired cron, StudioLoop, ProjectLoop, and watchdog entry points must remain disabled and fail closed if invoked.
2. **Do not auto-resume.** Preserve `agentic-ai-research` as stopped through schema and configuration changes. Starting new work requires an explicit operator action and a new traceable run.
3. **Migrate endpoint identity in stages.** Define stable endpoint IDs; verify their URL, runtime build, admission policy, model, and GPU affinity; backfill the three agent records deliberately; then make endpoint identity mandatory. Never infer affinity from `127.0.0.1`.
4. **Remove fallback before enabling the pool.** All dispatch paths must use the same allowlisted resolver. A missing endpoint produces a typed blocked result, not a localhost request.
5. **Split model lifecycle state.** Catalog, admission, load, health, and role eligibility require separate fields and API semantics. Unknown or stale state blocks routing.
6. **Preserve provenance without importing operations.** Inventory and hash the four historical roots, but do not copy or publish runtime databases, full logs, secrets, or credentials. Keep a protected operator backup outside this repository before any live database migration.
7. **Use schema-bound attempts.** Persist the exact [task, result, and verification envelopes](../schemas/README.md), endpoint/runtime identity, model artifact, configuration hashes, and receipts for each attempt.
8. **Require measured routing and an independent verifier.** A production mapping must validate against the [routing-manifest schema](../schemas/routing-manifest.schema.json), point to reproducible benchmark artifacts, and use a verifier that did not author the candidate result.
9. **Bound recovery.** Protocol, timeout, and context failures use typed stop/repair decisions and bounded retries from the [operating playbook](local-loop-operating-playbook.md). A retry must change a controlled variable and retain the prior attempt.

## Acceptance gates before dispatch is re-enabled

- Exactly one supported scheduler can mutate Company Runtime state; legacy authorities cannot enqueue or execute work.
- The existing `agentic-ai-research` project remains stopped unless an explicit start event is recorded.
- All three research-agent records have an intentional endpoint assignment, or are explicitly ineligible for local dispatch.
- Every dispatched attempt records an allowlisted endpoint ID, API base, runtime build/settings hash, loaded model identity, and GPU affinity.
- No request path can silently fall back to `http://127.0.0.1:1234`.
- `/api/models` reports installed, admitted, loaded, healthy, and role-eligible states without conflation.
- Regression probes cover the observed `gpt-oss` protocol, timeout, and context failure classes.
- Any routing manifest is generated from canonical benchmark results, schema-valid, and independently verified. Until then, the controller blocks profiles with no eligible candidate.
- Sanitized evidence is publishable; live databases, secrets, private prompts, and runtime logs remain outside Git.

## Canonical references

- [Repository scope and evidence rules](../AGENTS.md)
- [Local specialist-loop operating playbook](local-loop-operating-playbook.md)
- [Protocol schemas and validation rules](../schemas/README.md)
- [General-agent research consolidation map](consolidation-map.md)
- [Agentic architecture landscape](architecture-landscape.md)
- [Hardware and model shortlist](hardware-and-model-shortlist.md)
- [Benchmark status and result interpretation](../README.md)
- [Raw installed-model screen](../results/screen-all-installed.json)

This audit intentionally declares no model winner, default route, or parity with GPT Sol, Terra, or any other frontier system.
