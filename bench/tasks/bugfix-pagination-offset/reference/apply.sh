#!/usr/bin/env bash
python3 - <<'PYEOF'
with open("paginate.py") as f:
    content = f.read()
content = content.replace(
    "    start = page * page_size\n",
    "    start = (page - 1) * page_size\n",
)
with open("paginate.py", "w") as f:
    f.write(content)
PYEOF
