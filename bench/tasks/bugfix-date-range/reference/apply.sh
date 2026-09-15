#!/usr/bin/env bash
python3 - <<'PYEOF'
with open("daterange.py") as f:
    content = f.read()
content = content.replace(
    "    return start < d < end\n",
    "    return start <= d <= end\n",
)
with open("daterange.py", "w") as f:
    f.write(content)
PYEOF
