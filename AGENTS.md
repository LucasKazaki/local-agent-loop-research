# Mandatory project orientation

Before searching or opening source files, read `PROJECT_GUIDE.md`. It is the compact navigation layer; the rules below remain controlling.

## Local execution authority (2026-09-07)

The operator authorizes these Agent Studio loops to access and change their whole project workspace and registered worktrees, and to run local commands, dependency setup from available packages, builds, tests, inference, model evaluation, training, benchmarks, media processing, and overnight experiments. Missing exact-file allowlists and long duration are not permission gates.

Use the project-native executor (agentic-ai-research-project-executor) through Company Runtime: workflowId=project-execution, workflowVersion=1, actionScope=project_execution, requiresBrowser=false, input.commands=[{executable,args,timeoutMs:0}]. The default has no execution time limit. The existing durable runtime owns observation and recovery; retain task/job identity, inspect full logs under .agent-runtime/jobs, and never add a second scheduler or replay a retained job. Native jobs request the Windows offline profile, which on this host still allows loopback. Use local networking only for project test/model endpoints. Never use project code to access unrelated data, credentials or Studio operator APIs. Approved acquisition and external service actions use the existing scoped brokers.

This current authority supersedes older instructions saying the project has no command/test/inference broker or is limited to planning and exact-file edits. Preserve disjoint worktrees and file ownership, evidence and independent review requirements, and the existing credentials, authentication, rights, paid-service, external-contact, submission, publication, destructive-action and main-merge gates. A zero exit code proves execution, not scientific validity or release readiness. When hosted inside Lucas Agent Studio, use its registered project-execution contract; standalone clones must use the execution policy configured on their own host.

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

## Autonomous recovery and verified completion

When hosted inside Lucas Agent Studio, inherit its registered autonomy policy. Standalone clones must not assume a particular workstation path, executor, or authorization profile. Capture and fingerprint every failed recovery; reject identical strategies; try at least three materially different evidence-based paths before exhaustion when safe. Use the configured local API, CLI, recorded artifacts, alternate adapters, or a fresh bounded investigator instead of asking the operator to debug. Workers route only structured human-only blockers through the central escalation gateway and continue independent work.

- Doctor: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/doctor.ps1`
- Reproduce: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reproduce.ps1`
- Test/verify: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1`
- Smoke: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-test.ps1`
- Safe reset preview: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/safe-reset.ps1`

Completion requires real command receipts, applicable deterministic tests and validation, direct artifact inspection, non-reproduction, persistent evidence, and a different verifier for substantial changes. A benchmark parse, model agreement, diagnosis, or progress update cannot settle the task.

