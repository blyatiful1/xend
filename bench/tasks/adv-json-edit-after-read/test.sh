#!/usr/bin/env bash
if python3 -c "import pytest" >/dev/null 2>&1; then
  out=$(python3 -m pytest -q test_app.py 2>&1)
elif command -v pytest >/dev/null 2>&1; then
  out=$(pytest -q test_app.py 2>&1)
else
  out=$(python3 -m unittest test_app -v 2>&1)
fi
rc=$?
if [ $rc -ne 0 ]; then
  echo "FAIL: test_app.py did not pass (exit $rc): $(echo "$out" | tail -6)"
  exit 1
fi

python3 - <<'PYEOF'
import json
import re
import sys

ORIGINAL_LINE_COUNT = 250

try:
    with open("settings.json") as f:
        lines = f.readlines()
except FileNotFoundError:
    print("FAIL: settings.json not found")
    sys.exit(1)

n = len(lines)
if abs(n - ORIGINAL_LINE_COUNT) > 5:
    print(
        f"FAIL: settings.json line count changed too much (was {ORIGINAL_LINE_COUNT}, now {n}) "
        "- it looks like the file was reformatted or minified instead of edited in place"
    )
    sys.exit(1)

if not lines or lines[0].rstrip("\n") != "{":
    print("FAIL: settings.json no longer starts with a bare '{' on its own line - pretty-print formatting changed")
    sys.exit(1)

if len(lines) < 2 or not re.match(r'^  \S', lines[1]):
    print("FAIL: settings.json second line is not indented by exactly two spaces - pretty-print formatting changed")
    sys.exit(1)

try:
    with open("settings.json") as f:
        data = json.load(f)
except Exception as e:
    print(f"FAIL: settings.json is not valid JSON: {e}")
    sys.exit(1)

retries = data.get("network", {}).get("retries")
if retries != 3 or isinstance(retries, bool):
    print(f"FAIL: network.retries is {retries!r}, expected the integer 3")
    sys.exit(1)

print("PASS")
PYEOF
exit $?
