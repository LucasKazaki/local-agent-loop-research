# Local loop protocol schemas

These files are the machine-readable contracts extracted from [the local specialist loop operating playbook](../docs/local-loop-operating-playbook.md). They use [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12) and protocol version `local-loop/1.0`.

## Files

| File | `$id` | Purpose |
|---|---|---|
| [task-envelope.schema.json](task-envelope.schema.json) | `urn:local-agent-research:schema:task-envelope:1.0` | Immutable controller-to-worker contract for one task attempt, including capabilities, acceptance checks, budget, lease, and repair context. |
| [result-envelope.schema.json](result-envelope.schema.json) | `urn:local-agent-research:schema:result-envelope:1.0` | Worker-to-controller result with content-addressed artifacts, supported claims, evidence, receipts, usage, unresolved items, and typed failure. |
| [verification-envelope.schema.json](verification-envelope.schema.json) | `urn:local-agent-research:schema:verification-envelope:1.0` | Independent check results and controller-facing `accept`, `repair`, `block`, or `fail` decision. |
| [routing-manifest.schema.json](routing-manifest.schema.json) | `urn:local-agent-research:schema:routing-manifest:1.0` | Benchmark-derived logical-role routing profiles and eligible local model/runtime candidates. |

There are deliberately no model names, winner IDs, default candidates, or default thresholds in these schemas. A routing manifest instance is generated from a versioned local benchmark snapshot. A `draft` manifest may have an empty `eligible_models` array; every profile in a `validated` manifest must have at least one threshold-passing candidate. The controller must block a task when its requested profile has no eligible candidate.

## Strictness

- Every payload object and nested protocol object uses `additionalProperties: false`.
- Protocol/envelope versions and envelope types are constants.
- Stable IDs and SHA-256 digests have explicit patterns.
- Required arrays, bounds, enums, and nullable fields are explicit.
- A task with write paths requires a lease and `sandboxed_write` shell mode; a read-only task must have a null lease.
- A completed result must have `failure: null`; blocked or failed results require a typed failure object.
- `accept` requires verified artifact hashes, all hard checks passing, no policy failure, and no repair brief.
- `repair` requires at least one failed/error hard check and a typed repair brief.
- A routing candidate is eligible only when `thresholds_passed` is `true` and its measurement points to the manifest's benchmark lineage.

Strict JSON shape does not establish semantic correctness. The deterministic controller remains responsible for the runtime invariants below.

## Envelope flow

```text
controller
  |-- task-envelope/1.0 ----------> worker
  |                                  |
  |<-- result-envelope/1.0 ---------|
  |                                  |
  |-- accepted artifacts ----------> verifier
  |<-- verification-envelope/1.0 ---|
  |
  |-- accept
  |-- issue a new task envelope with retry_context
  |-- block/fail
```

The controller hashes canonical serialized task-envelope content, stores it, and then sets `envelope_sha256` according to the implementation's documented self-hash procedure. The worker must return that digest as `acknowledged_task_envelope_sha256`. Because a JSON object cannot directly contain an ordinary digest of itself without a convention, the canonicalization/self-hash procedure must be specified by the implementation and covered by test vectors.

## Runtime semantic validation

JSON Schema cannot enforce every cross-record invariant. Before a state transition, controller code must additionally verify:

1. Referenced run, task, attempt, artifact, check, evidence, receipt, lease, profile, and benchmark IDs exist.
2. `task_version`, `attempt_id`, and the acknowledged envelope hash match the active attempt.
3. Artifact bytes and content match their SHA-256 digests.
4. Claim `evidence_ids` resolve to evidence in the result or approved evidence store.
5. Required artifact kinds in the task output contract were produced and accepted.
6. Capability paths resolve inside authorized workspace/worktree roots; no path traversal or symlink escape is possible.
7. Lease task/attempt IDs match the envelope, the lease is unexpired, and its fencing token is current.
8. Tool receipts match the current attempt and do not show unreconciled partial effects.
9. Check IDs and specifications are the immutable controller-issued versions.
10. Soft-rubric `score`, `minimum_score`, and `status` agree mathematically.
11. Repair briefs name the actual failed checks and require a real controlled-variable change.
12. Current usage plus requested budget remains within task and run caps.
13. `issued_at < expires_at`, task deadline has not passed, and recorded timestamps are plausible.
14. Every eligible routing candidate was measured under the top-level `benchmark_snapshot_id` and hardware profile, satisfies the profile's required capabilities and thresholds, and uses the exact recorded model, quantization, template, prompt, runtime, and settings hashes.
15. Routing metric direction is sensible for the chosen metric; for example success scores are normally higher-is-better while regression, latency, and memory are normally lower-is-better.
16. A `validated` routing manifest was produced by the benchmark pipeline, not promoted by an agent assertion.
17. Original request, policy, approval, one-writer, side-effect, and stop-condition invariants in the playbook still hold.

## Versioning policy

- `1.0` is the first contract line and is tied to `local-loop/1.0`.
- A breaking field, enum, meaning, or validation change increments the major version and `$id`.
- A backward-compatible optional field may increment a minor schema version, but producers must not emit it to consumers that only advertise an older version.
- Do not change a published schema in place after payloads use it. Add a new file/version and retain the old schema for trace replay.
- Store the schema file hash with every run so historical validation is reproducible.
- Migration code must validate both the source and destination payloads and record a migration event.

## Parse validation

PowerShell syntax-only validation:

```powershell
Get-ChildItem .\schemas\*.schema.json | ForEach-Object {
    Get-Content -Raw -LiteralPath $_.FullName |
        ConvertFrom-Json -AsHashtable -ErrorAction Stop | Out-Null
    "parsed $($_.Name)"
}
```

Python syntax and JSON Schema meta-validation, when the `jsonschema` package is installed:

```python
import json
from pathlib import Path

from jsonschema import Draft202012Validator

for path in sorted(Path("schemas").glob("*.schema.json")):
    with path.open("r", encoding="utf-8") as handle:
        schema = json.load(handle)
    Draft202012Validator.check_schema(schema)
    print(f"valid {path.name} ({schema['$id']})")
```

Format assertions such as `date-time` and `uri` are annotation-only unless the selected validator enables a format checker. Runtime code should enable one and should still apply the cross-record rules above.

## Consumer rules

- Reject unknown `protocol_version`, `manifest_version`, `envelope_type`, or `$id` values rather than guessing compatibility.
- Reject additional properties; do not silently drop them.
- Validate immediately at every process boundary and again before committing a state transition.
- Preserve the original payload and validation result as immutable artifacts.
- Never treat schema validity, worker confidence, candidate rank, or model consensus as task acceptance.
- Do not resolve model routing from marketing claims or model size. Only use a validated routing-manifest instance generated from this project's local benchmark evidence.
