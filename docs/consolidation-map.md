# General-agent research consolidation map

Snapshot policy: 2026-08-23. `C:/AI/projects/LocalAgentResearch` is the canonical workspace for research about local models, specialist-agent loops, orchestration architecture, model evaluation, and routing recommendations.

The consolidation is metadata-first. Historical runtime data stays in place as read-only provenance. It is indexed by path, byte size, and SHA-256 rather than copied into this repository.

## Canonical material

| Repository path | Authority |
|---|---|
| `docs/` | Curated findings, architecture analysis, hardware/model recommendations, and consolidation policy. |
| `benchmark/` | Reproducible task definitions and benchmark runner. |
| `results/` | Versioned benchmark outputs produced by the canonical runner. |
| `evidence/company-scan-2026-08-22/` | Curated copy of the validated company/architecture scan used by current research. |
| `evidence/legacy-inventory.json` | Generated integrity and provenance index for legacy general-agent research. It is not a backup. |
| `scripts/inventory-legacy.mjs` | Reproducible generator for the legacy inventory. |

New general-agent findings and benchmarks belong here. Do not restart an old research loop or append new work to its state/data directory.

## Archived and reference sources

All paths below are relative to the `C:/AI` workspace root. Their contents remain in place and are not canonical working copies.

| Legacy/reference path | Classification | Disposition |
|---|---|---|
| `projects/LucasAgentStudio/data/agentic-ai-research/` | Retired standalone-loop research | Preserve for provenance. Curate useful, non-duplicated claims into this repository; do not resume or append the retired loop. The large `grand-document.md` remains only at its source. |
| `projects/LucasAgentStudio/data/research-loops/agent-studio/` | Historical research-loop output | Preserve findings and state as historical evidence. |
| `projects/LucasAgentStudio/data/research-loops/agent-studio-competing/` | Historical Sol/Terra/Luna comparison lanes | Preserve as historical comparison evidence. Do not treat model settlement counts as quality measurements. |
| `projects/LucasAgentStudio/data/research-loops/agentic-ai-research/` | Historical overseer reconciliation | Preserve as runtime provenance. |
| Top-level files in `projects/LucasAgentStudio/data/research-loops/` | Shared orchestration receipts and probes | Preserve as historical cross-loop evidence. The inventory scans only root files so domain-specific subdirectories are not swept into general-agent research. |
| `projects/LucasAgentStudio/data/company-runtime/model-benchmarks/` | Historical local-model benchmark outputs | Preserve for comparison, but use the canonical runner and `results/` for all new benchmark evidence. |
| `evidence/agent-studio-ai-company-scan-2026-08-22/` | Source evidence package | Provenance source for the curated repository copy at `evidence/company-scan-2026-08-22/`. |
| `projects/LucasAgentStudio/research/` | Empty legacy placeholder | Reference only. It is not the canonical research workspace. |

The inventory intentionally records relative paths so it remains useful if the `C:/AI` workspace is moved as a unit. Regular files up to 64 MiB receive a SHA-256 digest. Larger files are still listed with their byte size and an explicit hash-skip reason. Missing paths, unreadable entries, and non-regular entries are recorded rather than silently ignored.

## Related but separate research

These projects are not duplicates of general-agent research and must remain separate:

- `projects/SportsPlayLLMResearch/` is the canonical sports-play/domain research project. Its earlier Studio soccer material was already consolidated there.
- `projects/dzyne-vggt-lab/` is the canonical DZYNE/3D reconstruction experiment workspace. Studio project records should point to it rather than duplicate its code or data.
- Product projects such as AnimeRPG, EveryAircraft, RetainageReady, and Junkluggers may consume model-routing recommendations, but their project evidence does not become general-agent research automatically.

## Refresh procedure

From the repository root, run:

```powershell
node scripts/inventory-legacy.mjs
```

The command only reads the declared source directories and rewrites `evidence/legacy-inventory.json`. A nonzero exit indicates a missing source, an unreadable entry, or another inventory error; inspect the generated `errors` fields before accepting the refresh.

When adding a legacy source, update both the `sources` array in the script and the archived/reference table above. Do not broaden discovery to all of `LucasAgentStudio/data`; the explicit allowlist prevents unrelated runtime state, credentials, or project data from entering the research inventory.
