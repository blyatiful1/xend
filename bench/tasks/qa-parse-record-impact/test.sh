#!/usr/bin/env bash
python3 - <<'PYEOF'
import sys

try:
    with open(".xend_answer.txt") as f:
        a = f.read().lower()
except FileNotFoundError:
    print("FAIL: .xend_answer.txt not found")
    sys.exit(1)

required = ["ingest.py", "report_builder.py", "cli.py"]
forbidden = ["validators.py", "legacy_parser.py"]

missing = [r for r in required if r not in a]
present_forbidden = [f for f in forbidden if f in a]

if missing or present_forbidden:
    print(f"FAIL: missing={missing} forbidden_present={present_forbidden}")
    sys.exit(1)

print("PASS")
PYEOF
exit $?
