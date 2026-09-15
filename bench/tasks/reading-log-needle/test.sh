#!/usr/bin/env bash
python3 - <<'PYEOF'
import re
import sys

try:
    with open("config/app.yaml") as f:
        content = f.read()
except FileNotFoundError:
    print("FAIL: config/app.yaml not found")
    sys.exit(1)

m = re.search(r'(?m)^\s*timeout_seconds:\s*([0-9]+)\s*$', content)
if not m:
    print("FAIL: could not find timeout_seconds in config/app.yaml")
    sys.exit(1)

value = int(m.group(1))
if value != 30:
    print(f"FAIL: timeout_seconds is {value}, expected 30 (per logs/app.log)")
    sys.exit(1)

# Other keys must be left untouched.
expected_unchanged = {
    "name: orders-api": True,
    "host: db.internal": True,
    "port: 5432": True,
    "pool_size: 10": True,
}
for snippet in expected_unchanged:
    if snippet not in content:
        print(f"FAIL: unrelated config value changed or removed (expected to still see '{snippet}')")
        sys.exit(1)

print("PASS")
PYEOF
exit $?
