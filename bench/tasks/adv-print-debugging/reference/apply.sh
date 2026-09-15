#!/usr/bin/env bash
python3 - <<'PYEOF'
with open("analytics.py") as f:
    content = f.read()

buggy = (
    "    # BUG: this squares the *sum* of the deviations instead of summing the\n"
    "    # *squares* of the deviations. Since deviations from the mean always\n"
    "    # sum to (approximately) zero, this collapses the variance to ~0.\n"
    "    return sum(deviations) ** 2 / len(values)\n"
)
fixed = "    return sum(d ** 2 for d in deviations) / len(values)\n"

if buggy not in content:
    raise SystemExit("reference apply.sh: expected buggy snippet not found in analytics.py")

content = content.replace(buggy, fixed)

with open("analytics.py", "w") as f:
    f.write(content)
PYEOF
