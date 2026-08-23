# Source and methodology notes

## Reporting job

- Question: Which current AI-company product patterns should Lucas Agent Studio copy, adapt, defer, or reject?
- Decision: Prioritize the next shared product primitives and project pilots.
- Audience: Product stakeholder / owner.
- Scope: 18 companies across coding agents, agent infrastructure, vertical enterprise AI, creative AI, and research/productivity AI; source state reviewed through August 22, 2026.
- Comparison baseline: Lucas Agent Studio's checked-in product contract plus a read-only snapshot of its four active runtime projects.
- Success criterion: A recommendation that identifies what to build next, why it fits the current system, how it applies to live projects, and which market patterns are traps.

## Executive-report structure map

The selected `product stakeholders` contract requires: title; Executive Summary; findings with visual evidence; next steps; further questions; caveats and assumptions. The compact HTML report includes every required role; the detailed company comparison, scoring model, and project applications remain in this note and the companion notebook.

## Source inventory

Primary product documentation was preferred. Company performance figures were omitted from the main report unless they were needed to understand a product model; vendor-hosted outcomes were not treated as independently audited evidence.

- Career/opportunity agents: JoinRunway official product and terms.
- Coding/build agents: Cursor official product/docs; Cognition/Devin docs; Replit docs; LangChain/LangGraph/LangSmith docs; CrewAI docs and official GitHub.
- Vertical/enterprise agents: Sierra, Decagon, Glean, Harvey, Hebbia, and Abridge official product, security, evaluation, and release-governance materials.
- Creative/research products: RunwayML, ElevenLabs, Perplexity, Granola, Gamma, and Suno official product/help documentation.
- Internal baseline: Lucas Agent Studio `README.md`, `docs/company-runtime.md`, `src/server/code-workspace.js`, `src/server/document-store.js`, `src/client/workbench-model.js`, and read-only queries against the SQLite runtime.

## Quantitative decision model

Near-term pattern priority uses a 0-100 weighted score:

- Evidence of current pain: 30%
- Cross-project leverage: 25%
- Fit with the existing event-driven architecture: 20%
- Trust and defensibility contribution: 15%
- Delivery ease: 10%

Each input is rated 1-5. `priority_score = weighted_input / 5 × 100`. These values are structured expert judgment, not statistical estimates or forecasts. The score is used to make tradeoffs explicit; it does not prove ROI.

## Chart map

| Report segment | Analytical question | Form | Fields | Supported claim | Palette policy |
|---|---|---|---|---|---|
| Current operating constraint | Where is unresolved active work accumulating? | Ranked horizontal bar | project, frontier_tasks | The review/blocked/waiting frontier spans every active project and totals 818 tasks. | Single-root/identity blue. |

The report chart uses four reviewed rows at one active-project grain. The notebook retains the 20-row project/status detail and the 10-row roadmap-priority model. No trend or scatter chart is warranted because neither comparison is a time series nor a two-variable relationship.

## Reproducibility

- Companion notebook: `analysis.ipynb`.
- Notebook runtime query grain: one row per active project and task status, with zero-filled ready/running/review/blocked/waiting categories. The report chart aggregates review, blocked, and waiting into one frontier value per active project.
- Runtime scope: projects with `desired = 1` and no archive timestamp; task states are a point-in-time operational snapshot.
- Company feature inventory: one representative primary-source anchor per company, with additional official pages used during the review.

## Caveats and omitted metrics

- The runtime state is not a causal explanation of why work is blocked or in review. Task-level sampling would be needed to quantify root causes.
- The study does not estimate engineering effort in person-weeks, revenue impact, market size, or vendor market share; no sufficiently comparable source existed, and those estimates are not required to choose the first product primitives.
- Pricing and customer-outcome claims vary in definition across vendors and were not used to rank patterns.
- Some capabilities are enterprise-tier or newly launched; implementation detail and durability can change.
- The scoring model should be recalibrated after the first two pilots produce acceptance, intervention, time-to-verified-output, and outcome data.

## Validation record

- Notebook structure and execution: completed top-to-bottom with the task-local Python kernel.
- Runtime headline spot-check: 4 active projects; 0 ready/running; 426 review; 391 blocked; 1 waiting; 389 open interventions.
- Arithmetic: 426 + 391 + 1 = 818 current review/blocked/waiting tasks.
- Company inventory: 18 distinct companies, each with an HTTPS primary-source anchor.
- Report artifact/render validation: passed at 1440px desktop and 390px mobile; 3 rendered blocks, 1 chart, source dialog passed, and keyboard/menu source interaction passed. A scoped `overflow-x` containment rule was added after the packaged shell exposed an 8-pixel scrollbar-width overflow; the canonical embedded artifact remained unchanged and the packaged verifier passed after the fix.
