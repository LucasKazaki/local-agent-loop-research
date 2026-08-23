"""Build provisional machine-readable report input from all results JSON files."""

from pathlib import Path
import sys


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT))

from analysis.benchmark_results import build_analysis, write_analysis_artifact  # noqa: E402


def main() -> None:
    analysis = build_analysis(
        REPOSITORY_ROOT / "results",
        REPOSITORY_ROOT / "reports" / "result-validation-2026-08-23-final.json",
    )
    output_path = REPOSITORY_ROOT / "reports" / "benchmark-analysis-input.json"
    write_analysis_artifact(analysis, output_path)
    quality = analysis["dataQuality"]
    print(
        f"Wrote {output_path.relative_to(REPOSITORY_ROOT).as_posix()} from "
        f"{quality['inputFileCount']} JSON files and {quality['caseObservations']} normalized cases."
    )
    print(
        f"Complete raw reports: {quality['completeRawReportCount']}; "
        f"partial raw reports: {quality['partialRawReportCount']}; "
        f"missing suite kinds: {', '.join(quality['missingBenchmarkKinds']) or 'none'}."
    )
    print(
        f"Validated measurement reports: {quality['validatedMeasurementReportCount']}; "
        f"excluded raw reports: {quality['excludedRawReportCount']}."
    )


if __name__ == "__main__":
    main()
