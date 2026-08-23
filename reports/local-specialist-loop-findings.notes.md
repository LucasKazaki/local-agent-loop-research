# Local Specialist Loops report notes

## Reporting job

- Question: Which local models and loop patterns are defensible for specialist-agent work on the RTX 3070 + GTX 1080 workstation?
- Audience: technical.
- Scope: retained measurements and primary-source architecture research available on August 23, 2026.
- Comparison basis: normalized scores only within their named suite; single- versus dual-GPU placement within the same llama-bench plan; direct versus self-refine versus cross-specialist on shared loop tasks.
- Decision supported: choose provisional role routes and a bounded escalation protocol while identifying the evidence still required for admission.
- Success criterion: every quantitative claim is traceable to selected raw artifacts through the final validator receipt and the report evidence extraction.
- Disqualifier: any claim of Sol/Terra parity, use of incomplete/invalid/confounded evidence as leaderboard evidence, or automatic production admission.

## Technical-report structure mapping

| Required role | Visible section |
|---|---|
| Title | Local Specialist Loops: Measured Findings and Operating Design |
| Technical summary | The evidence supports role routing, not a frontier substitute |
| Key findings with visual evidence | Text roles split; GPT-OSS code result; loop ablation; dual-GPU placement; vision tie; resident endpoints |
| Scope, data, and metric definitions | Scope and metric definitions bound every conclusion |
| Methodology | Validation was necessary, then manual confound review narrowed the evidence |
| Limitations, uncertainty, and robustness | Uncertainty is dominated by small suites; explicit exclusions; paired placement rounds; shared loop tasks |
| Recommended next steps | Next steps should test the routing hypothesis, not celebrate it |
| Further questions | Further questions |
| Model/experimental validation detail | Loop ablation, placement, route table, and exclusion table are dedicated sections rather than footnotes |

No required role was omitted. Implications are integrated into the technical summary and each finding rather than added as a standalone implications section.

## Chart map

| Segment | Analytical question | Family / type | Fields | Supported claim | Palette | Final surface |
|---|---|---|---|---|---|---|
| Text roles | Which selected clean text-screen result was strongest? | Comparison / horizontal bar | model, normalizedScore; case/failure/throughput tooltips | Devstral led this small screen, while E4B was much faster | single-root blue | Portable HTML report |
| Code worker | Which selected model performed best on executable code tasks? | Comparison / horizontal bar | model, normalizedScore; passed checks/throughput tooltips | GPT-OSS narrowly led Devstral and materially led E4B | single-root gold | Portable HTML report |
| Loop ablation | Did automatic critique improve aggregate score? | Comparison / bar | protocol, normalizedScore; calls/wall/tokens tooltips | Neither loop treatment beat direct; self-refine regressed | single-root orange | Portable HTML report |
| GPU placement | Does using both GPUs improve Devstral generation throughput? | Comparison / bar | placement-round case, generationTokensPerSecond; prompt/VRAM tooltips | Dual placement was faster and more stable in two rounds | single-root olive | Portable HTML report |

All four visuals use bars because every question is a categorical magnitude comparison, not a temporal trend, distribution, composition, or relationship. Horizontal orientation is used for long model labels; vertical orientation is used for short protocol and placement labels. Legends are omitted because each chart has one measure and the axis already carries category identity. Exact values and caveats remain adjacent in narrative and tables.

The configured vision result is intentionally a table: three of four models sit at the six-case ceiling, so a bar chart would add little beyond exact lookup. Dual residency, provisional routing, and exclusions are also tables because audit detail matters more than shape.

## Evidence review and exclusions

- The final validator receipt covers 25 artifacts: 24 valid, 20 complete, and 17 comparison-eligible.
- Structural comparison eligibility was necessary but not sufficient. Nine artifacts were selected after manual process-confound review.
- Known co-residency, background runtime loading, endpoint failure, interrupted execution, identity mismatch, superseded screen settings, and smoke-only scope are explicit exclusions in the evidence file and visible report table.
- The Qwen3.5 isolated vision artifact is excluded from report claims because another model was observed co-resident; only the configured sequential comparison is used.
- The r3/r4 placement artifacts are excluded for background runtime interference; only the studio-closed r5 artifact is used.
- The older loop artifact is excluded because its cross-specialist endpoint failed on 11 of 12 tasks; only the clean dual-endpoint ablation is used.

## Reproducibility notes

- `local-specialist-loop-findings.evidence.json` is the reviewed extraction and retains raw artifact paths and SHA-256 identities.
- `local-specialist-loop-findings.artifact.json` is the canonical portable report input.
- Each chart, card, and table has a canonical source. Its SQL is a deterministic SQLite `VALUES` replay of the reviewed extraction, and the source path points back to the evidence file containing raw lineage.
- The HTML is generated output from the canonical Data Analytics portable artifact builder; it is not a parallel handwritten report runtime.
- The report-specific delivery adapter calls the canonical validator, portable builder, chart extractor, and browser verifier. It changes one shared reader CSS declaration from `width: 100vw` with viewport margins to `width: 100%` with zero margins. Browser diagnostics showed that the packaged rule overhung the document by 8 px only when the long report created a vertical scrollbar. The workaround changes no artifact payload, evidence, chart, table, token, or reading order.
- The report deliberately makes no matched frontier comparison and no Sol/Terra parity claim.
