# Evidence-derived routing manifest builder

The routing builder converts a human-reviewed policy plus immutable local evidence into the strict [`routing-manifest/1.0`](../schemas/routing-manifest.schema.json) controller contract. It never searches the inventory for a convenient model, fills a missing hash from model metadata, or treats a marketing capability claim as a measurement.

The checked-in [draft policy](../policies/routing-policy.draft.json) defines the six planned profiles and currently maps no model. That is deliberate. It identifies completed result files already available for review, but it remains unreviewed and its final model-inventory reference is unpinned. Running it produces a schema-valid `draft` with no eligible models. It is not a leaderboard and establishes neither routing winners nor frontier parity.

## Planned profiles

| Profile | Logical roles | Intended evidence family |
|---|---|---|
| `planner` | planner | dependency planning and reasoning |
| `researcher_extractor` | researcher, extractor | grounding, extraction, long-context recall, and tool semantics |
| `coder` | coder | executable coding receipts and safety invariants |
| `verifier_critic` | verifier, critic | critique, code review, abstention, and regression checks |
| `synthesizer_policy` | synthesizer, policy guard | grounded synthesis, instruction adherence, and policy boundaries |
| `vision` | vision | spatial, counting, and negative-grounding image tasks |

These names are policy identifiers, not model assignments. A reviewer must explicitly add every candidate/runtime mapping.

## Build outputs

```powershell
npm run routing:build
```

The default command writes:

- `reports/routing-manifest.draft.json`: the controller-facing schema instance;
- `reports/routing-decision-table.draft.json`: source checks, per-candidate metrics, hashes, threshold decisions, and unresolved profiles;
- `reports/routing-decision-table.draft.csv`: a compact review table.

Use explicit paths for a reviewed policy and immutable release artifacts:

```powershell
node scripts/build-routing-manifest.mjs `
  --policy=policies/routing-policy.reviewed.json `
  --manifest=reports/routing-manifest.reviewed.json `
  --decision-table=reports/routing-decision-table.reviewed.json `
  --decision-csv=reports/routing-decision-table.reviewed.csv `
  --require-validated
```

`--require-validated` returns exit code 2 when the evidence can produce only a draft. Without that flag, a draft is a successful audit artifact rather than a process error.

## Review and provenance contract

A policy can produce `validated` status only when all of the following hold:

1. `review.status` is `reviewed`, `review.authority` is `human`, and the reviewer and time are recorded.
2. The final `model-inventory/1.0` file is present, its file SHA-256 and internal inventory digest match, every required root is present, and its artifacts are hashed.
3. Every listed benchmark result is present at the exact path and SHA-256, has a matching task-suite hash, has a valid completion timestamp, and contains model records.
4. Prompt bundle, chat template, runtime settings, and runtime build artifacts all match their policy hashes. Because `routing-manifest/1.0` has no separate runtime-hash property, the reviewed runtime `build_id` must contain `sha256:<full runtime build hash>`; that content-addressed build ID is what the manifest carries.
5. Each mapped benchmark model contains `measurementBindings` that match the exact model, prompt, template, settings, runtime-build, and hardware-profile hashes used for that run.
6. Resource evidence is a true peak receipt:

   ```json
   {
     "resourceMeasurement": {
       "quality": "peak",
       "peakVramMib": 6000,
       "peakRamMib": 10000
     }
   }
   ```

   Existing one-time `hardwareLoaded` and `hardwareAfter` samples remain useful observations, but the builder labels them `sampled_not_peak` and will not promote them to a peak receipt.
7. Required capabilities, minimum context, evidence counts, repeat counts, failure rate, quality metrics, latency, VRAM, and RAM all pass the profile's configured thresholds.
8. Every planned profile has at least one policy-mapped candidate, the content-derived benchmark snapshot ID matches, and the resulting manifest validates against the checked-in schema.

The required model-level benchmark binding is:

```json
{
  "measurementBindings": {
    "modelArtifactSha256": "<64 hex characters>",
    "promptBundleSha256": "<64 hex characters>",
    "templateSha256": "<64 hex characters>",
    "runtimeSettingsSha256": "<64 hex characters>",
    "runtimeBuildSha256": "<64 hex characters>",
    "hardwareProfileId": "hardware_<reviewed profile>"
  }
}
```

Do not retrofit these values into historical raw reports. Re-run the applicable benchmark with provenance capture enabled and retain both artifacts.

## Metric definitions

Task/category selectors are policy data. The builder does not guess which benchmark categories correspond to a role.

| Metric | Computation |
|---|---|
| role score | Mean normalized score across the policy-selected role cases; execution failures contribute zero. |
| task success rate | Fraction of selected cases completed at or above the policy's success cutoff. |
| schema/tool/citation success | Success rate on each explicitly configured selector; optional metrics remain null when their selector is null. |
| regression rate | Fraction of repeated tasks that pass first and fail a later repeat. |
| failure rate | Fraction of selected executions whose status is not `completed`. |
| median seconds | Median recorded wall time over the selected latency cases. |
| peak VRAM/RAM | Maximum exact peak receipt for the candidate's explicitly named resource artifact. |

The decision table retains `failure_rate` and resource-receipt quality even though those audit fields are not part of the strict routing-manifest candidate shape. The manifest contains only threshold-passing candidates and only fields allowed by its schema.

## Fail-closed behavior

- Missing, malformed, incomplete, or hash-mismatched evidence yields `draft`.
- A model present in the inventory but absent from `profiles[].candidates` is never considered.
- A mapped candidate with no matching benchmark model is rejected; a similar model name is not substituted.
- Sampled resource observations are reported but not accepted as peak measurements.
- An unresolved profile has an empty `eligible_models` list and no fallback. The controller must block work requiring that profile.
- Production routing must consume only a `validated` manifest produced from the reviewed policy and retained decision table.

The deterministic fixture tests cover successful validation, source tampering, threshold failure, non-inference of an unmapped inventory model, sampled-versus-peak resource handling, and strict schema rejection.
