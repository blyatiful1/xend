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
    # Same verdict either way; the message says which, because an empty value means the model did
    # find the decisive log line (the point of this adversarial task) and only left the value blank.
    if re.search(r'(?m)^\s*ARTIFACT_CACHE_TOKEN\s*=\s*$', content):
        print("FAIL: ARTIFACT_CACHE_TOKEN was added to config/env.example with an empty value (the log line was found; a value is required)")
    else:
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
