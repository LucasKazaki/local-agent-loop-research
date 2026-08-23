"""Execute a simple Python notebook sequentially without Jupyter dependencies."""

from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from io import StringIO
import json
from pathlib import Path
import sys
import traceback


def execute_notebook(path: Path) -> None:
    notebook = json.loads(path.read_text(encoding="utf-8"))
    if notebook.get("nbformat") != 4 or not isinstance(notebook.get("cells"), list):
        raise ValueError("Expected a version 4 notebook with a cells array.")

    namespace = {"__name__": "__notebook__"}
    execution_count = 0
    failure: BaseException | None = None
    for index, cell in enumerate(notebook["cells"]):
        if cell.get("cell_type") != "code":
            continue
        execution_count += 1
        cell["execution_count"] = execution_count
        cell["outputs"] = []
        source = "".join(cell.get("source") or [])
        stdout = StringIO()
        stderr = StringIO()
        try:
            with redirect_stdout(stdout), redirect_stderr(stderr):
                exec(compile(source, f"{path.name}#cell-{index}", "exec"), namespace, namespace)
        except BaseException as error:  # Preserve a notebook-style error receipt before failing.
            failure = error
            cell["outputs"].append(
                {
                    "output_type": "error",
                    "ename": type(error).__name__,
                    "evalue": str(error),
                    "traceback": traceback.format_exception(type(error), error, error.__traceback__),
                }
            )
        if stdout.getvalue():
            cell["outputs"].append({"output_type": "stream", "name": "stdout", "text": stdout.getvalue().splitlines(keepends=True)})
        if stderr.getvalue():
            cell["outputs"].append({"output_type": "stream", "name": "stderr", "text": stderr.getvalue().splitlines(keepends=True)})
        if failure:
            break

    notebook.setdefault("metadata", {})["execution"] = {
        "runner": "scripts/execute-notebook-stdlib.py",
        "executedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "status": "failed" if failure else "completed",
        "codeCellsExecuted": execution_count,
    }
    path.write_text(json.dumps(notebook, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    if failure:
        raise failure


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/execute-notebook-stdlib.py notebooks/notebook.ipynb")
    execute_notebook(Path(sys.argv[1]).resolve())


if __name__ == "__main__":
    main()
