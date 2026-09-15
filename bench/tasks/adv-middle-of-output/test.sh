#!/usr/bin/env bash
python3 - <<'PYEOF'
import re
import sys

try:
    with open("config/env.example") as f:
        content = f.read()
except FileNotFoundError:
    print("FAIL: config/env.example not found")
    sys.exit(1)

m = re.search(r'(?m)^\s*ARTIFACT_CACHE_TOKEN\s*=\s*\S+', content)
if not m:
    print("FAIL: ARTIFACT_CACHE_TOKEN was not added to config/env.example (per build/build.log)")
    sys.exit(1)

# The other pre-existing variables must be left untouched.
expected_unchanged = [
    "DATABASE_URL=postgres://localhost:5432/xend",
    "REDIS_URL=redis://localhost:6379",
    "LOG_LEVEL=info",
    "BUILD_ENV=development",
]
for snippet in expected_unchanged:
    if snippet not in content:
        print(f"FAIL: unrelated env var changed or removed (expected to still see '{snippet}')")
        sys.exit(1)

print("PASS")
PYEOF
exit $?
