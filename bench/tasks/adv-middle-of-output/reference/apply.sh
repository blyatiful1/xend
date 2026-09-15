#!/usr/bin/env bash
python3 - <<'PYEOF'
with open("config/env.example") as f:
    content = f.read()
if not content.endswith("\n"):
    content += "\n"
content += "ARTIFACT_CACHE_TOKEN=changeme\n"
with open("config/env.example", "w") as f:
    f.write(content)
PYEOF
