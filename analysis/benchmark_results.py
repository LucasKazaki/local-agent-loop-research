"""Normalize heterogeneous local-agent benchmark reports with no third-party dependencies."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import statistics
from typing import Any, Iterable


RAW_REPORT_KINDS = ("text", "code", "vision", "loop")


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _round(value: float | None, digits: int = 6) -> float | None:
    return None if value is None else round(value, digits)


def _mean(values: Iterable[float | None]) -> float | None:
    usable = [value for value in values if value is not None]
    return statistics.fmean(usable) if usable else None


def _percentile(values: Iterable[float | None], percentile: float) -> float | None:
    usable = sorted(value for value in values if value is not None)
    if not usable:
        return None
    if len(usable) == 1:
        return usable[0]
    position = (len(usable) - 1) * percentile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return usable[lower]
    return usable[lower] + (usable[upper] - usable[lower]) * (position - lower)


def classify_report(report: dict[str, Any]) -> str:
    if report.get("provenance") is not None and report.get("cases") is not None:
        return "derived"
    if report.get("design") is not None and report.get("cases") is not None:
        return "loop"
    if report.get("executionPolicy") is not None and report.get("models") is not None:
        return "code"
    suite = report.get("suite") or {}
    if suite.get("imageSha256") is not None or suite.get("tasks") is not None:
        return "vision"
    if report.get("taskSuite") is not None and report.get("models") is not None:
        return "text"
    return "unknown"


def load_result_reports(results_root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    reports: list[dict[str, Any]] = []
    inventory: list[dict[str, Any]] = []
    for path in sorted(results_root.rglob("*.json"), key=lambda item: item.as_posix().lower()):
        relative_path = path.relative_to(results_root.parent).as_posix()
        stat_before = path.stat()
        raw_bytes = path.read_bytes()
        stat_after = path.stat()
        record: dict[str, Any] = {
            "path": relative_path,
            "sizeBytes": len(raw_bytes),
            "sha256": hashlib.sha256(raw_bytes).hexdigest(),
            "changedDuringRead": (
                stat_before.st_size != stat_after.st_size
                or stat_before.st_mtime_ns != stat_after.st_mtime_ns
                or stat_after.st_size != len(raw_bytes)
            ),
            "parseError": None,
        }
        try:
            payload = json.loads(raw_bytes.decode("utf-8"))
            if not isinstance(payload, dict):
                raise TypeError("Top-level JSON value is not an object.")
            kind = classify_report(payload)
            record.update(
                {
                    "kind": kind,
                    "schemaVersion": payload.get("schemaVersion"),
                    "startedAt": payload.get("startedAt"),
                    "finishedAt": payload.get("finishedAt"),
                    "runComplete": bool(payload.get("finishedAt")),
                    "includedInMeasurements": kind in RAW_REPORT_KINDS,
                }
            )
            reports.append({"path": relative_path, "kind": kind, "sha256": record["sha256"], "payload": payload})
        except Exception as error:  # A malformed partial artifact should not stop the notebook.
            record.update(
                {
                    "kind": "parse_error",
                    "schemaVersion": None,
                    "startedAt": None,
                    "finishedAt": None,
                    "runComplete": False,
                    "includedInMeasurements": False,
                    "parseError": f"{type(error).__name__}: {error}",
                }
            )
        inventory.append(record)
    return reports, inventory


def _expected_cases(report: dict[str, Any], kind: str) -> int:
    options = report.get("options") or {}
    repeats = int(_number(options.get("repeats")) or 1)
    if kind == "text":
        task_ids = (report.get("taskSuite") or {}).get("taskIds") or []
    elif kind == "code":
        suite = report.get("suite") or {}
        task_ids = suite.get("taskIds") or []
        repeats = int(_number(suite.get("repeats")) or repeats)
    elif kind == "vision":
        task_ids = (report.get("suite") or {}).get("tasks") or []
    else:
        task_ids = []
    return len(task_ids) * repeats


def _model_metadata(model: dict[str, Any]) -> tuple[str | None, float | None]:
    metadata = model.get("meta") or {}
    quantization = metadata.get("quantization") or {}
    quantization_name = quantization.get("name") if isinstance(quantization, dict) else quantization
    size_bytes = _number(metadata.get("sizeBytes"))
    return quantization_name, (size_bytes / 2**30 if size_bytes is not None else None)


def _case_score(item: dict[str, Any], kind: str) -> float | None:
    if kind == "code":
        return _number((item.get("receipt") or {}).get("score"))
    score = item.get("score")
    if isinstance(score, dict):
        score = score.get("score")
    return _number(score)


def _response_metrics(item: dict[str, Any]) -> dict[str, float | int | None]:
    response = item.get("response") or {}
    stats = response.get("stats") or {}
    usage = response.get("usage") or {}
    tokens_per_second = _number(stats.get("tokens_per_second"))
    if tokens_per_second is None:
        tokens_per_second = _number(stats.get("predicted_tokens_per_second"))
    return {
        "wallMs": _number(response.get("wallMs")) or _number(item.get("wallMs")),
        "tokensPerSecond": tokens_per_second,
        "timeToFirstTokenSeconds": _number(stats.get("time_to_first_token")),
        "promptTokens": int(_number(usage.get("prompt_tokens")) or 0) if usage else None,
        "completionTokens": int(_number(usage.get("completion_tokens")) or 0) if usage else None,
    }


def normalize_model_reports(reports: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    cases: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []
    for source in reports:
        kind = source["kind"]
        if kind not in ("text", "code", "vision"):
            continue
        report = source["payload"]
        run_complete = bool(report.get("finishedAt"))
        expected = _expected_cases(report, kind)
        for model in report.get("models") or []:
            model_name = str(model.get("model") or "unknown")
            quantization, size_gib = _model_metadata(model)
            model_cases = model.get("cases") or []
            completed = sum(1 for item in model_cases if item.get("status") == "completed")
            coverage.append(
                {
                    "source": source["path"],
                    "benchmarkKind": kind,
                    "runComplete": run_complete,
                    "model": model_name,
                    "modelStatus": model.get("status"),
                    "expectedCases": expected,
                    "observedCases": len(model_cases),
                    "completedCases": completed,
                    "failedCases": len(model_cases) - completed,
                    "missingCases": max(expected - len(model_cases), 0),
                    "coverageRate": _round(len(model_cases) / expected if expected else None),
                    "quantization": quantization,
                    "sizeGiB": _round(size_gib, 3),
                }
            )
            for item in model_cases:
                metrics = _response_metrics(item)
                receipt = item.get("receipt") or {}
                cases.append(
                    {
                        "source": source["path"],
                        "sourceSha256": source["sha256"],
                        "benchmarkKind": kind,
                        "runComplete": run_complete,
                        "model": model_name,
                        "modelStatus": model.get("status"),
                        "quantization": quantization,
                        "sizeGiB": _round(size_gib, 3),
                        "taskId": item.get("taskId"),
                        "category": item.get("category") or "uncategorized",
                        "repeat": item.get("repeat"),
                        "status": item.get("status") or "unknown",
                        "score": _case_score(item, kind),
                        "receiptStatus": receipt.get("status") if kind == "code" else None,
                        "error": item.get("error") or receipt.get("error"),
                        **metrics,
                    }
                )
    return cases, coverage


def normalize_loop_reports(reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for source in reports:
        if source["kind"] != "loop":
            continue
        report = source["payload"]
        options = report.get("options") or {}
        run_complete = bool(report.get("finishedAt"))
        for item in report.get("cases") or []:
            for method in ("direct", "selfRefine", "crossSpecialist"):
                result = item.get(method) or {}
                score = result.get("score")
                if isinstance(score, dict):
                    score = score.get("score")
                rows.append(
                    {
                        "source": source["path"],
                        "sourceSha256": source["sha256"],
                        "runComplete": run_complete,
                        "solver": options.get("solver"),
                        "critic": options.get("critic"),
                        "taskId": item.get("taskId"),
                        "category": item.get("category") or "uncategorized",
                        "repeat": item.get("repeat"),
                        "method": method,
                        "status": result.get("status") or "not_started",
                        "score": _number(score),
                        "calls": int(_number(result.get("calls")) or 0),
                        "wallMs": _number(result.get("wallMs")),
                        "completionTokens": int(_number(result.get("completionTokens")) or 0),
                        "error": result.get("error"),
                    }
                )
    return rows


def _coverage_totals(coverage: list[dict[str, Any]], key_fields: tuple[str, ...]) -> dict[tuple[Any, ...], dict[str, Any]]:
    totals: dict[tuple[Any, ...], dict[str, Any]] = defaultdict(
        lambda: {"expectedCases": 0, "observedCases": 0, "missingCases": 0, "coverageSources": 0, "loadFailedSources": 0}
    )
    for row in coverage:
        key = tuple(row.get(field) for field in key_fields)
        value = totals[key]
        value["expectedCases"] += row["expectedCases"]
        value["observedCases"] += row["observedCases"]
        value["missingCases"] += row["missingCases"]
        value["coverageSources"] += 1
        value["loadFailedSources"] += int(row.get("modelStatus") == "load_failed")
    return totals


def aggregate_cases(
    cases: list[dict[str, Any]],
    key_fields: tuple[str, ...],
    coverage: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    grouped: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in cases:
        grouped[tuple(row.get(field) for field in key_fields)].append(row)
    coverage_by_key = _coverage_totals(coverage or [], key_fields)
    for key in coverage_by_key:
        grouped.setdefault(key, [])

    output: list[dict[str, Any]] = []
    for key in sorted(grouped, key=lambda value: tuple(str(item) for item in value)):
        rows = grouped[key]
        completed = [row for row in rows if row.get("status") == "completed"]
        scores = [row.get("score") for row in rows if row.get("score") is not None]
        completed_scores = [row.get("score") for row in completed if row.get("score") is not None]
        wall_ms = [row.get("wallMs") for row in completed]
        throughput = [row.get("tokensPerSecond") for row in completed]
        ttft = [row.get("timeToFirstTokenSeconds") for row in completed]
        base = {field: key[index] for index, field in enumerate(key_fields)}
        totals = coverage_by_key.get(key)
        record = {
            **base,
            "sourceCount": len({row.get("source") for row in rows}),
            "observations": len(rows),
            "completedCases": len(completed),
            "failedCases": len(rows) - len(completed),
            "failureRate": _round((len(rows) - len(completed)) / len(rows) if rows else None),
            "scoreSum": _round(sum(score or 0 for score in scores)),
            "meanScoreAllAttempts": _round(sum(score or 0 for score in scores) / len(rows) if rows else None),
            "meanScoreCompleted": _round(_mean(completed_scores)),
            "zeroScoreCases": sum(1 for score in scores if score == 0),
            "zeroScoreRate": _round(sum(1 for score in scores if score == 0) / len(scores) if scores else None),
            "meanLatencyMs": _round(_mean(wall_ms), 3),
            "medianLatencyMs": _round(statistics.median([value for value in wall_ms if value is not None]), 3) if any(value is not None for value in wall_ms) else None,
            "p95LatencyMs": _round(_percentile(wall_ms, 0.95), 3),
            "meanTokensPerSecond": _round(_mean(throughput), 3),
            "medianTokensPerSecond": _round(statistics.median([value for value in throughput if value is not None]), 3) if any(value is not None for value in throughput) else None,
            "meanTimeToFirstTokenSeconds": _round(_mean(ttft), 4),
            "completionTokens": sum(int(row.get("completionTokens") or 0) for row in rows),
            "completeRunObservations": sum(1 for row in rows if row.get("runComplete")),
            "partialRunObservations": sum(1 for row in rows if not row.get("runComplete")),
            "quantizations": sorted({str(row.get("quantization")) for row in rows if row.get("quantization")}),
        }
        if totals:
            record.update(totals)
            record["coverageRate"] = _round(totals["observedCases"] / totals["expectedCases"] if totals["expectedCases"] else None)
        output.append(record)
    return output


def aggregate_loop_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[(row["source"], row["method"])].append(row)
    methods: list[dict[str, Any]] = []
    for (source, method), values in sorted(grouped.items()):
        completed = [row for row in values if row["status"] == "completed"]
        score_sum = sum((row.get("score") or 0) for row in values)
        methods.append(
            {
                "source": source,
                "runComplete": all(row.get("runComplete") for row in values),
                "solver": values[0].get("solver"),
                "critic": values[0].get("critic"),
                "method": method,
                "caseSlots": len(values),
                "completedCases": len(completed),
                "failedOrMissingCases": len(values) - len(completed),
                "coverageRate": _round(len(completed) / len(values) if values else None),
                "scoreSum": _round(score_sum),
                "passRateAllSlots": _round(score_sum / len(values) if values else None),
                "meanScoreCompleted": _round(_mean(row.get("score") for row in completed)),
                "calls": sum(row.get("calls") or 0 for row in values),
                "wallSeconds": _round(sum(row.get("wallMs") or 0 for row in values) / 1000, 3),
                "completionTokens": sum(row.get("completionTokens") or 0 for row in values),
            }
        )

    by_source = defaultdict(dict)
    for row in methods:
        by_source[row["source"]][row["method"]] = row
    deltas: list[dict[str, Any]] = []
    for source, values in sorted(by_source.items()):
        direct = values.get("direct")
        if not direct:
            continue
        for method in ("selfRefine", "crossSpecialist"):
            candidate = values.get(method)
            if not candidate:
                continue
            deltas.append(
                {
                    "source": source,
                    "runComplete": candidate["runComplete"],
                    "solver": candidate.get("solver"),
                    "critic": candidate.get("critic"),
                    "method": method,
                    "passRateDeltaVsDirect": _round((candidate.get("passRateAllSlots") or 0) - (direct.get("passRateAllSlots") or 0)),
                    "scoreDeltaVsDirect": _round((candidate.get("scoreSum") or 0) - (direct.get("scoreSum") or 0)),
                    "callsDeltaVsDirect": candidate.get("calls", 0) - direct.get("calls", 0),
                    "wallSecondsDeltaVsDirect": _round((candidate.get("wallSeconds") or 0) - (direct.get("wallSeconds") or 0), 3),
                    "completionTokensDeltaVsDirect": candidate.get("completionTokens", 0) - direct.get("completionTokens", 0),
                }
            )
    return methods, deltas


def _load_validation_receipt(path: Path) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        raise ValueError(f"Invalid validation receipt: {path}")
    by_path: dict[str, dict[str, Any]] = {}
    for item in payload["results"]:
        if isinstance(item, dict) and isinstance(item.get("file"), str):
            by_path[item["file"].replace("\\", "/")] = item
    return by_path, payload


def build_analysis(results_root: Path, validation_receipt_path: Path | None = None) -> dict[str, Any]:
    results_root = results_root.resolve()
    reports, inventory = load_result_reports(results_root)
    if validation_receipt_path is None:
        validation_receipt_path = results_root.parent / "reports" / "result-validation-2026-08-23-final.json"
    validation_by_path, validation_receipt = _load_validation_receipt(validation_receipt_path.resolve())

    inventory_by_path = {item["path"]: item for item in inventory}
    for source in reports:
        if source["kind"] not in RAW_REPORT_KINDS:
            continue
        validation = validation_by_path.get(source["path"])
        hash_matches = bool(validation and validation.get("artifactSha256") == source["sha256"])
        eligible = bool(
            validation
            and hash_matches
            and validation.get("valid") is True
            and validation.get("complete") is True
            and validation.get("comparisonEligible") is True
        )
        source["validation"] = validation
        source["includedInMeasurements"] = eligible
        inventory_by_path[source["path"]].update(
            {
                "validationPresent": validation is not None,
                "validationHashMatches": hash_matches,
                "validationValid": validation.get("valid") if validation else None,
                "validationComplete": validation.get("complete") if validation else None,
                "validationComparisonEligible": validation.get("comparisonEligible") if validation else None,
                "includedInMeasurements": eligible,
            }
        )

    measurement_reports = [source for source in reports if source.get("includedInMeasurements")]
    cases, coverage = normalize_model_reports(measurement_reports)
    loop_rows = normalize_loop_reports(measurement_reports)
    loop_methods, loop_deltas = aggregate_loop_rows(loop_rows)
    kinds = Counter(item["kind"] for item in inventory)
    raw_inventory = [item for item in inventory if item["kind"] in RAW_REPORT_KINDS]
    measurement_inventory = [item for item in raw_inventory if item.get("includedInMeasurements")]
    excluded_inventory = [item for item in raw_inventory if not item.get("includedInMeasurements")]
    complete_kinds = sorted({item["kind"] for item in raw_inventory if item["runComplete"]})
    present_kinds = sorted({item["kind"] for item in raw_inventory})
    missing_kinds = [kind for kind in RAW_REPORT_KINDS if kind not in present_kinds]
    partial_paths = [item["path"] for item in raw_inventory if not item["runComplete"]]

    per_model = aggregate_cases(cases, ("model",), coverage)
    per_model_benchmark = aggregate_cases(cases, ("model", "benchmarkKind"), coverage)
    per_model_category = aggregate_cases(cases, ("model", "benchmarkKind", "category"))
    data_quality = {
        "inputFileCount": len(inventory),
        "parsedFileCount": sum(item["kind"] != "parse_error" for item in inventory),
        "parseErrorCount": sum(item["kind"] == "parse_error" for item in inventory),
        "changedDuringReadCount": sum(bool(item.get("changedDuringRead")) for item in inventory),
        "fileKinds": dict(sorted(kinds.items())),
        "rawReportCount": len(raw_inventory),
        "validatedMeasurementReportCount": len(measurement_inventory),
        "excludedRawReportCount": len(excluded_inventory),
        "excludedRawReportPaths": [item["path"] for item in excluded_inventory],
        "completeRawReportCount": sum(item["runComplete"] for item in raw_inventory),
        "partialRawReportCount": len(partial_paths),
        "partialRawReportPaths": partial_paths,
        "presentBenchmarkKinds": present_kinds,
        "completeBenchmarkKinds": complete_kinds,
        "missingBenchmarkKinds": missing_kinds,
        "caseObservations": len(cases),
        "completedCaseObservations": sum(row["status"] == "completed" for row in cases),
        "failedCaseObservations": sum(row["status"] != "completed" for row in cases),
        "loopMethodObservations": len(loop_rows),
    }

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "status": "provisional-measurements",
        "conclusionPolicy": {
            "finalModelWinnerDeclared": False,
            "frontierParityEstablished": False,
            "readyForFinalConclusions": False,
            "reason": "The artifact is a measurement input. Final conclusions require new complete runs across relevant suites, review of partial-run warnings, and a separately defined frontier comparison.",
        },
        "evidenceLabels": {
            "measured": "Computed from a raw benchmark case retained in results/.",
            "partial": "Computed from an unfinished run; missing cases are reported separately and are not silently imputed.",
            "derived": "Recomputed aggregation, not an independent measurement.",
            "notMeasured": "No matching raw benchmark artifact was present.",
        },
        "source": {
            "root": "results",
            "validationReceipt": validation_receipt_path.relative_to(results_root.parent).as_posix(),
            "validationReceiptContentSha256": validation_receipt.get("receiptContentSha256"),
            "files": inventory,
        },
        "dataQuality": data_quality,
        "reportBuilder": {
            "suggestedSections": ["data-quality", "coverage", "model-metrics", "category-metrics", "loop-deltas", "limitations"],
            "rankingAllowed": False,
            "requiredWarnings": [
                "Partial runs are included only as observed evidence and retain explicit coverage fields.",
                "Derived JSON is inventoried but excluded from measurement aggregation to prevent double counting.",
                "No frontier-parity claim is supported by this artifact.",
            ],
        },
        "tables": {
            "reportInventory": inventory,
            "modelCoverage": coverage,
            "perModel": per_model,
            "perModelBenchmark": per_model_benchmark,
            "perModelCategory": per_model_category,
            "loopMethods": loop_methods,
            "loopDeltas": loop_deltas,
            "normalizedCases": cases,
            "normalizedLoopCases": loop_rows,
        },
    }


def write_analysis_artifact(analysis: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(analysis, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def format_table(rows: list[dict[str, Any]], columns: list[str], limit: int = 20) -> str:
    if not rows:
        return "(no rows)"
    selected = rows[:limit]
    widths = {
        column: min(48, max(len(column), *(len(str(row.get(column, ""))) for row in selected)))
        for column in columns
    }
    header = " | ".join(column.ljust(widths[column]) for column in columns)
    separator = "-+-".join("-" * widths[column] for column in columns)
    body = [
        " | ".join(str(row.get(column, ""))[: widths[column]].ljust(widths[column]) for column in columns)
        for row in selected
    ]
    suffix = [f"... {len(rows) - limit} more rows"] if len(rows) > limit else []
    return "\n".join([header, separator, *body, *suffix])
