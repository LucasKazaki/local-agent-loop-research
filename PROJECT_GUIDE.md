# Project Guide — Local Agent Research

## Purpose

Evidence-based research on local-model capability, benchmark results, model placement, and routing. The repository does not claim frontier parity unless the current validated evidence supports it.

## Read in this order

1. `AGENTS.md` — execution and evidence requirements.
2. `README.md` — current status, reproducibility, and repository map.
3. For routing work: `docs/routing-manifest-builder.md` and the relevant policy/schema.
4. For a result: its validator, source result envelope, and current validation status before drawing conclusions.

## Map

| Location | Use |
| --- | --- |
| `benchmark/` | Benchmark suites and runners |
| `analysis/`, `notebooks/` | Analysis code and reproducible exploration |
| `scripts/` | Operational checks, inventory, routing-manifest, and report builders |
| `tests/` | Deterministic tests |
| `schemas/` | Result, task, verification, and routing contracts |
| `policies/` | Draft/active routing policy material |
| `results/` | Raw and derived benchmark outputs; verify before reuse |
| `reports/` | Produced analyses and validation receipts |
| `evidence/` | Source-level research evidence |
| `docs/` | Architecture, runtime audit, operating playbook, context efficiency, and consolidation map |

## Working rules

Choose a named suite or research question, then read only its runner, schema, result, and validator. Preserve raw results; create new derived outputs rather than silently rewriting them. Use `scripts/doctor.ps1`, `reproduce.ps1`, `verify.ps1`, and `smoke-test.ps1` as appropriate.

## Token-saving rules

Do not enumerate all `results/` or `reports/`. Use `docs/result-validation-status.md`, `docs/consolidation-map.md`, and the relevant manifest to select a single artifact chain.
