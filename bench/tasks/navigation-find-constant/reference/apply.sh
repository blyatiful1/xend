#!/usr/bin/env bash
python3 - <<'PYEOF'
with open("client.py") as f:
    content = f.read()

old = "# The actual retry budget used by fetch_with_retries.\nMAX_RETRIES = 3\n"
new = "# The actual retry budget used by fetch_with_retries.\nMAX_RETRIES = 5\n"

if old not in content:
    raise SystemExit("expected pattern not found in client.py")

content = content.replace(old, new)
with open("client.py", "w") as f:
    f.write(content)
PYEOF
