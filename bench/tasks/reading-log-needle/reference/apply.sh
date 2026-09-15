#!/usr/bin/env bash
python3 - <<'PYEOF'
with open("config/app.yaml") as f:
    content = f.read()
content = content.replace("timeout_seconds: 5\n", "timeout_seconds: 30\n")
with open("config/app.yaml", "w") as f:
    f.write(content)
PYEOF
