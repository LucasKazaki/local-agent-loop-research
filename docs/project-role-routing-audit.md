# Lucas Agent Studio project/role routing audit

Date: 2026-08-23

Status: **source proposal only; Lucas Agent Studio has a separate provisional runtime-enabled copy installed by explicit user request**
Machine-readable receipt: [project-role-routing-audit.json](../reports/project-role-routing-audit.json)

## Decision

Do not promote a project routing manifest yet. The current results support a useful *candidate* two-tier design, but not a production lock:

1. Keep `granite-4.1-8b` as the static GPU1 llama.cpp research/grounding service. On GPU0, exclusively time-slice `google/gemma-4-e4b` for planning/synthesis alongside the larger escalation models; do not assume E4B can remain resident while those models run.
2. Load `openai/gpt-oss-20b` on GPU0 on demand for code first; retain `mistralai_devstral-small-2-24b-instruct-2512` as the slower, independent code alternative. Treat both as exclusive, time-sliced escalation models.
3. Keep `qwen/qwen3.5-9b` as a time-sliced **provisional vision route only**. The clean r3 run completed 6/6 cases and passed the suite-aware validator, but GPT-OSS was observed temporarily co-resident during the run. Semantic completion is **Measured** and structurally **Validated**; exclusive-residency admission remains **Inference** and provisional.
4. Resolve verification dynamically from the producer family where the controller can. The schema-v1 proposal must choose static role routes, so it prefers Gemma E4B for QA after Granite/GPT-OSS producers and Granite for overseers after Gemma planners, while explicitly recording that this cannot guarantee family diversity for every task.
5. Leave audio/video, browser/application action, legal/licensing, domain-judgment, and composite roles unresolved until their own task suites pass.

These are **Inference** and **Hypothesis** labels under this repository's evidence rules. They are not proof of parity with GPT Sol or Terra. All 16 projects lack an end-to-end, project-specific local-model benchmark.

## What the measurements actually support

| Candidate | Intended tier | Measured result | Supported use | Important limit |
|---|---|---|---|---|
| `google/gemma-4-e4b` Q4_K_M, 5.892 GiB | GPU0 exclusive time-slice | 17.714/20, 0.886 pass rate, 20/20 requests completed, 67.94 tok/s; planning 0.857, critique 1.0 | Planning, bounded synthesis, policy/oversight, critic after Granite | Coding category was 0; do not route code |
| `granite-4.1-8b` Q4_K_M, 4.981 GiB | GPU1 static llama.cpp candidate | 17.333/20, 0.867 pass rate, 20/20 completed, 26.61 tok/s; grounding/tool/safety/reasoning/long-context 1.0 | Research, source grounding, deterministic evidence verification after a non-Granite producer | Extraction was 0.667 and free-form critique was 0; it is not a general critic |
| `openai/gpt-oss-20b` MXFP4, 11.278 GiB | Time-sliced coding escalation, primary | 8.80/10, 48/52 VM tests, 10/10 requests completed, 36.51 tok/s | Bounded code generation/repair with tests | Generic planning was 0 in the screen; model is too large for the operational pair |
| `mistralai_devstral-small-2-24b-instruct-2512` Q3_K_M, 10.687 GiB | Time-sliced coding escalation, alternate | 8.55/10, 47/52 VM tests, 10/10 requests completed, 5.09 tok/s | Independent alternate code proposal or difficult repair | Roughly seven times slower in measured token throughput than GPT-OSS |
| `qwen/qwen3.5-9b` Q4_K_M | Time-sliced vision, provisional | 6/6 in `vision-qwen3.5-isolated-r3-clean.json`, all responses semantically complete; validator reports valid, complete, comparison-eligible | Still-image localization, counting, and negative grounding proposal only | GPT-OSS was observed temporarily co-resident during the run, so sole-residency admission was not demonstrated; no temporal-video or audio coverage |

Evidence files:

- Gemma/general screen: [screen-finalists-isolated-r2.json](../results/screen-finalists-isolated-r2.json)
- Granite/general screen: [screen-granite-isolated-r2.json](../results/screen-granite-isolated-r2.json)
- Code comparison: [code-finalists-isolated-r2.json](../results/code-finalists-isolated-r2.json)
- Vision configured run: [vision-configured-finalists-r2.json](../results/vision-configured-finalists-r2.json)
- Vision isolated run: [vision-finalists-isolated-r2.json](../results/vision-finalists-isolated-r2.json)
- Generic loop ablation: [loop-ablation-e4b-granite-r2-clean.json](../results/loop-ablation-e4b-granite-r2-clean.json)
- Dual-resident loop ablation: [loop-ablation-e4b-granite-dual-resident-r2.json](../results/loop-ablation-e4b-granite-dual-resident-r2.json), validated by [result-validation-loop-dual-resident.json](../reports/result-validation-loop-dual-resident.json)
- Clean Qwen vision rerun: [vision-qwen3.5-isolated-r3-clean.json](../results/vision-qwen3.5-isolated-r3-clean.json), validated by [result-validation-vision-qwen-r3.json](../reports/result-validation-vision-qwen-r3.json)
- Dual-resident observations: [Gemma E4B](../results/dual-resident-e4b.json) and [Granite](../results/dual-resident-granite.json)

The draft decision table confirms the final model inventory and selected benchmark artifacts by SHA-256. The inventory contains 20 hashed GGUF files with valid headers and zero inventory errors. The overall routing decision still fails closed because the policy is unreviewed and contains no candidate mappings. See [routing-decision-table.draft.json](../reports/routing-decision-table.draft.json). The separate Granite, configured-vision, and dual-resident files are completed raw measurements, not a reviewed production snapshot.

The suite-aware validator now recognizes text, executable-code, vision, reasoning-profile, loop-ablation, and llama.cpp placement result families. The selected text, code, vision, and loop artifacts are **Measured** and structurally **Validated**; their hashes and dispositions are retained in [result-validation-2026-08-23.json](../reports/result-validation-2026-08-23.json) and summarized in [result-validation-status.md](result-validation-status.md). These labels do not remove cross-run confounds or turn the proposed routes into measured project-level outcomes. The reasoning-profile receipt is excluded for exact instance-identity mismatches, interrupted checkpoints remain excluded, and placement receipts do not establish a winner.

The validated dual-resident loop ablation measured direct pass rate **0.5929**, same-model self-refinement **0.1921**, and cross-specialist **0.5869**, with all 12 cases complete in every arm. Cross-specialist execution is now operational, but it did not beat direct generation and used three calls per case. This supports **selective escalation only** when deterministic checks, uncertainty, or task risk justify an independent critic; it does not support wrapping every task in more turns. The direct and self-refine arms were reused byte-for-byte from the earlier clean artifact, with lineage recorded in the new result.

The clean Qwen r3 vision artifact scored **6/6** across two repeats of localization, counting, and negative-grounding tasks, and its validator receipt reports valid, complete, and comparison-eligible. A contemporaneous runtime observation found GPT-OSS temporarily co-resident during the run. Because that residency fact is not established by the semantic result or validator, Qwen may appear only in this schema-v1 **provisional** proposal; production admission still requires an exclusive-residency rerun with sole-model telemetry.

The two dual-resident reports show both GPUs occupied during simultaneous one-repeat work. They do **not** identify a stable model-to-endpoint/GPU binding, and Granite's endpoint omitted throughput telemetry. “Always resident” is therefore a deployment hypothesis to retest under explicit endpoint identities, not a proven production placement.

## Routing rules future builders must preserve

The shorthand in the inventory is:

- **G** — `planner_synthesis_operational`: Gemma E4B.
- **R** — `research_grounding_operational`: Granite.
- **VE** — static schema-v1 QA preference: Gemma E4B after Granite/GPT-OSS/Qwen producers.
- **VG** — static schema-v1 overseer preference: Granite after Gemma planners.
- **C** — `coding_escalation`: GPT-OSS primary, Devstral alternate, exclusive/time-sliced.
- **Qp** — `vision_escalation_provisional`: Qwen3.5, semantically validated but residency-provisional.
- **Ø** — no evidence or disabled; fail closed.

The producer/critic rule is mandatory: the acceptance critic must use a different model family from the producer. A same-family second pass is repair or self-review, not independent evidence. In particular:

- Gemma producer → Granite grounding/evidence verifier.
- Granite producer → Gemma critic/synthesizer.
- GPT-OSS or Devstral code producer → Granite plus deterministic tests/static checks; Gemma may provide an additional synthesis review.
- Qwen vision producer → no admitted independent local vision critic exists; use fixed visual fixtures and human review.

The schema-v1 proposal cannot express “choose a different family from the producer” dynamically. It therefore pins QA-style suffixes to E4B and overseer-style suffixes to Granite based on the dominant expected producer. If the actual producer is already E4B for QA or Granite for oversight, the static verifier is correlated and cannot independently accept the result. The controller must substitute a different-family verifier or fail closed. See [the complete provisional proposal](../reports/local-model-routes.provisional.schema-v1.json).

That proposal enumerates all 16 projects and reconciles all 83 registered project agents: 73 receive provisional routes (32 E4B, 30 Granite, 9 GPT-OSS, and 2 Qwen), while 10 `no_evidence` or `disabled_no_route` agents are deliberately absent. Every project is `localOnly: true` with no default route, so an omitted or unknown role fails closed. Devstral remains an explicit time-sliced independent code-alternate utility route rather than receiving an arbitrary project assignment.

The source proposal is revision `local-agent-research-provisional-2026-08-23-r2`, SHA-256 `75d8fadf50123ddc70facc6ba37e4554783d8b9a00d4df75b604eaff3d6166dc`. GPU0 declares `runtimeManagedContext: true` because Bionic 1.0.1 ignored explicit `context_length` in both the native load API and `lms load`. This is not permission to accept unknown residency: the controller must verify the requested model is the sole loaded admitted LLM and `parallel=1` both before and after inference. The research proposal remains provisional, non-human-reviewed, and not production-authorized.

Separately, LucasAgentStudio has a provisional runtime-enabled installed copy by explicit user request. That installed state does not promote this source proposal or establish production authorization, and this audit update did not modify LucasAgentStudio.

Granite's measured zero on the generic critique category means “Granite verification” is deliberately narrow. It may reconcile citations, evidence rows, safety gates, schemas, and deterministic acceptance results; it must not be the only semantic critic.

## Complete current project and role inventory

This snapshot contains 16 effective projects and 83 project-scoped agents. It excludes 11 projectless global/compatibility agents: `main`, `hermes-agent`, `second-brain`, `research-agent`, `claude-code`, `codex-reviewer`, `local-utility`, `unreal-specialist`, `qa-specialist`, `admin-specialist`, and `rsc2-agent`.

Every mapping below is task-family inference. The “gap” column names project contracts not covered by the current suites.

| Project and state | Exact registered role suffixes or exceptional IDs | Proposed task-family mapping | Evidence gap / admission block |
|---|---|---|---|
| `agentic-ai-research` · active | `lab-director`, `researcher`, `overseer` | G: `lab-director`; R: `researcher`; VG: `overseer` | No project-specific end-to-end research loop; the generic cross-specialist result supports selective escalation only |
| `dzyne` · active frontier profiles | `lab-director`, `company-analyst`, `research-scout`, `agent`, `qa` | G: `lab-director`; R: `company-analyst`, `research-scout`; C: `agent`; VE: `qa` | No aerial-3D, gated-data, licensing, export-control, or experiment-reproducibility eval; do not replace frontier-only profiles |
| `soccer-research` · active | `lab-director`, `lab-tester`, `llm-tester` | G: `lab-director`; VE: `lab-tester`; Qp: `llm-tester` | No temporal soccer-video or annotation-agreement eval; Qwen evidence covers still images only |
| `studio` · active, generic templates | `lab-director`, `researcher`, `developer`, `qa`, `overseer` | G: `lab-director`; R: `researcher`; C: `developer`; VE: `qa`; VG: `overseer` | No full Studio change-and-verification loop eval |
| `loop-ops-supervisor` · active | `lab-director`, `repair-agent`, `research-agent` | G: `lab-director`; C: `repair-agent`; R: `research-agent` | No live scheduler, loop-state, replay-safety, or recovery eval |
| `sports-play-llm` · active, metadata override | `lab-director`, `researcher`, `developer`, `qa` | G: `lab-director`; R: `researcher`; C: `developer`; VE: `qa` | No temporal-video/project scoring eval; ownership overlaps `soccer-research` |
| `every-aircraft` · active, metadata override | `lab-director`, `researcher`, `producer`, `qa` | G: `lab-director`; R: `researcher`; Ø: `producer`; VE: `qa` | No video/audio/editing/rights/publication or aircraft-domain eval |
| `rsc2` · active | `lab-director`, `researcher`, `developer`, `qa`, `overseer` | G: `lab-director`; R: `researcher`; C: `developer`; VE: `qa`; VG: `overseer` | No repository-, browser-boundary-, or end-to-end acceptance eval |
| `retainage-ready` · active | `lab-director`, `revenue-scout`, `intake-analyst`, `packet-builder`, `qa-controller`, `client-success` | G: `lab-director`, `packet-builder`, `client-success`; R: `revenue-scout`, `intake-analyst`; VE: `qa-controller` | No construction-evidence, commercial-calculation, contract, lien, legal, or customer-decision eval |
| `internships-ai-software` · retired/offline/audit-only | `researcher` | Ø: `researcher` | Must remain disabled; routing must not reactivate it |
| `internships-aerospace` · retired/offline/audit-only | `researcher` | Ø: `researcher` | Must remain disabled; routing must not reactivate it |
| `internships` · active plus legacy compatibility | `agent`, `sol-niche-applier`, `lab-director`, `operations-supervisor`, `researcher`, `developer`, `qa`, `overseer`, `nsf-reu-scout`, `handshake-scout`, `motorsport-racing-scout`, `aerospace-autonomy-scout`, `ai-research-labs-scout`, `startups-scout`, `big-tech-scout`, `government-contractors-scout`, `other-job-sites-scout`, `experiment-controller` | Ø: `agent`, `sol-niche-applier`; G: `lab-director`, `operations-supervisor`; R: `researcher` and all nine scouts; C: `developer`; VE: `qa`, `experiment-controller`; VG: `overseer` | No authenticated-browser, application-action, eligibility, identity, dedupe, or receipt eval. `sol-niche-applier` is described as disabled but remains available: fail closed |
| `animerpg` · active hybrid | `lab-director`, `developer`, `engine-systems-developer`, `engine-architect`, `engine-upgrade-sol`, `game-design`, `narrative-director`, `researcher`, `qa`, `art-director`, `rendering-tech-art`, `audio-director`, `performance`, `overseer` | G: `lab-director`, `game-design`, `narrative-director`; R: `engine-architect`, `researcher`; C: `developer`, `engine-systems-developer`; VE: `qa`, `performance`; VG: `overseer`; Qp: `art-director`; Ø: `rendering-tech-art`, `audio-director`, `engine-upgrade-sol` | No engine/native-build/runtime/art/audio/protected-content eval. Frontier-only roles stay unchanged. Split `rendering-tech-art` into vision, research, and code packets before routing |
| `junkluggers-internal-app` · active plus hardware-gated profile | `lab-director`, `researcher`, `developer`, `qa`, `inkling-small-auditor` | G: `lab-director`; R: `researcher`; C: `developer`; VE: `qa`; Ø: `inkling-small-auditor` | No private-app, customer-workflow, accessibility, screenshot, or audio eval; Inkling has no admission artifact |
| `veritasium-second-brain` · stored-only | exceptional director ID `project-veritasium-second-brain-director`; suffix `av-analyst` | G: exceptional director; Ø: `av-analyst` | No audio-video transcription, temporal-evidence, or factual-correction eval |
| `summer-2027-internship-research` · stored-only | exceptional director ID `project-summer-2027-internship-research-director`; `ai-software-researcher`, `aerospace-researcher`, `qa` | G: exceptional director; R: both researchers; VE: `qa` | No live-posting identity, eligibility, freshness, duplicate, or lane-boundary eval |

### Registry sources and snapshot identity

The role snapshot was deterministically inspected from these Studio files:

- `C:/AI/projects/LucasAgentStudio/src/server/project-registry.js` — seed projects, project templates, retired-role rewrite, local role policy, and `listProjects()` merge; SHA-256 `14b9803b45e6d067b56a5e1a706f2948d601c784d870c82da168de6bd503125c`.
- `C:/AI/projects/LucasAgentStudio/src/server/agent-registry.js` — generic templates, synthesized directors, dynamic `<project>-<suffix>` IDs, and compatibility agents; SHA-256 `605e7b9d00232a6d9dfe0f59441ac79db29f2a35f6c18dd1b8d837287cfa5210`.
- `C:/AI/projects/LucasAgentStudio/data/projects.json` — durable stored projects and shallow metadata overrides; SHA-256 `950ecfc23bf8503dc2e1ee1f2ae8346685538a13da9a112b6dcd69499019a783`.
- `C:/AI/projects/LucasAgentStudio/data/agent-config.json` — editable overlays on registered IDs; SHA-256 `0dae72c3dd6289d7da2a0a3d5f6b974c86bff97c1cf98a9e8c455675929d261a`.

`listProjects()` shallow-merges durable records over seeds while preserving a seed's ID. Agent config cannot create a missing role; it overlays an already registered ID. The current agent config contains two orphaned application profiles (`internships-ai-software-applier` and `internships-aerospace-applier`) and the disabled-label/status mismatch on `internships-sol-niche-applier`. Those are topology defects, not model-selection evidence.

Line-level source locators were inspected at:

- project seeds: `project-registry.js:66-569` and `project-registry.js:661-681`;
- retired internship rewrite: `project-registry.js:685-708`;
- project merge: `project-registry.js:773-789`;
- generic/synthesized project agents: `agent-registry.js:40-55`;
- stored-only projects: `data/projects.json:3-156`.

## Unresolved evidence and promotion gates

No project in this inventory has project-specific admission evidence. The generic results justify which candidates to test next; they do not justify changing every role merely because its suffix resembles a benchmark category.

Before producing `results/routing-manifest.final.json`, require all of the following:

1. Have a human review the routing policy, add explicit candidate mappings with immutable model/runtime/prompt/settings identities, and rebuild the routing decision. `results/model-inventory-final.json` is now complete and hash-verified, but the current [draft manifest](../reports/routing-manifest.draft.json) has zero eligible models and is correctly unresolved.
2. Treat suite-aware structural validation as necessary but not sufficient. Review the retained [validation receipt](../reports/result-validation-2026-08-23.json), resolve every excluded or contaminated artifact, and require matched experimental settings before admitting a comparison.
3. Re-run Gemma and Granite concurrently through explicit endpoint IDs and exclusive-residency telemetry. Prove that each request used its pinned model and that the proposed operational pair remains stable under loop concurrency.
4. Re-run Qwen3.5 vision under enforced exclusive residency and retain sole-loaded-model telemetry. The r3 result establishes 6/6 semantic completion under its task contract, but the temporary GPT-OSS co-residency observation keeps deployment admission provisional.
5. Add project-specific admission suites before replacing frontier-only or safety-sensitive roles. At minimum: Studio code loop, DZYNE provenance/governance, Internships no-action/browser safety, AnimeRPG build/runtime, media temporal/audio, and Retainage domain/calculation gates.
6. Use the completed dual-resident loop ablation as a selective-escalation baseline: direct 0.5929, self-refinement 0.1921, cross-specialist 0.5869, all 12 cases complete. Add higher-risk and failure-triggered strata before deciding when the extra critic/finalizer calls pay for themselves. More turns alone are not intelligence evidence.
7. Lock the producer family and critic family in each task receipt. Reject same-family acceptance and any verifier that silently generated or repaired the artifact it approves.

Until these gates pass, this audit is durable research guidance only. LucasAgentStudio's active routing configuration remains authoritative and unchanged.
