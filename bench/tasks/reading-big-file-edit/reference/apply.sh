#!/usr/bin/env bash
python3 - <<'PYEOF'
with open("bigmod.py") as f:
    content = f.read()

old = (
    "    for item in items:\n"
    "        if item not in seen:\n"
    "            result.append(item)\n"
    "            # BUG: forgot to record `item` as seen, so nothing is ever\n"
    "            # recognized as a duplicate on later iterations.\n"
    "    return result\n"
)
new = (
    "    for item in items:\n"
    "        if item not in seen:\n"
    "            result.append(item)\n"
    "            seen.append(item)\n"
    "    return result\n"
)

if old not in content:
    raise SystemExit("expected buggy pattern not found in bigmod.py")

content = content.replace(old, new)
with open("bigmod.py", "w") as f:
    f.write(content)
PYEOF
