#!/usr/bin/env bash
python3 - <<'PYEOF'
import os

NUM_MODULES = 12
# 20-25 call sites per module, ~260 total.
COUNTS = [20, 21, 22, 23, 24, 25, 20, 21, 22, 23, 24, 25]
assert len(COUNTS) == NUM_MODULES

total_calls = 0
for i in range(1, NUM_MODULES + 1):
    n_calls = COUNTS[i - 1]
    lines = []
    lines.append("from moneymod.fmt import fmt_money")
    lines.append("")
    lines.append("")
    for j in range(1, n_calls + 1):
        lines.append(f"def line_{j:03d}(amount):")
        lines.append("    return fmt_money(amount)")
        lines.append("")
        lines.append("")
    path = f"moneymod/mod_{i:02d}.py"
    with open(path, "w") as f:
        f.write("\n".join(lines).rstrip("\n") + "\n")
    total_calls += n_calls

print(f"generated {NUM_MODULES} modules with {total_calls} fmt_money call sites", flush=True)
PYEOF
