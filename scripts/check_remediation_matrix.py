#!/usr/bin/env python3
from pathlib import Path

MATRIX_PATH = Path("docs/remediation-matrix.md")


def main() -> int:
    if not MATRIX_PATH.exists():
        print(f"ERROR: missing {MATRIX_PATH}")
        return 1

    violations = []
    for line in MATRIX_PATH.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| R-"):
            continue
        parts = [p.strip() for p in line.strip("|").split("|")]
        if len(parts) < 7:
            continue
        item_id, _source, severity, _owner, _milestone, status, disposition = parts[:7]
        if severity.lower() == "high" and status.lower() == "completed":
            if disposition.lower() in {"", "tbd", "-"}:
                violations.append(item_id)

    if violations:
        print("ERROR: completed High-severity items without explicit disposition:")
        for item in violations:
            print(f" - {item}")
        return 1

    print("Remediation matrix policy check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
