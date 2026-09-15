#!/usr/bin/env bash
python3 - <<'PYEOF'
with open("settings.json") as f:
    content = f.read()
content = content.replace('"retries": "3"', '"retries": 3')
with open("settings.json", "w") as f:
    f.write(content)
PYEOF
