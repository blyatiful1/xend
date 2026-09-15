#!/usr/bin/env bash
python3 - <<'PYEOF'
with open("retry.js") as f:
    content = f.read()
content = content.replace(
    "      lastError = err;\n      return null; // BUG: this should let the loop continue to the next attempt\n",
    "      lastError = err;\n",
)
with open("retry.js", "w") as f:
    f.write(content)
PYEOF
