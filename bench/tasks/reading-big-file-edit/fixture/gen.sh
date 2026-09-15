#!/usr/bin/env bash
python3 - <<'PYEOF'
NUM_FILLER = 208
INSERT_TARGET_AFTER = 60  # insert the real (buggy) function after this many fillers

lines = []
lines.append('"""bigmod.py - assorted small utilities used across the activity feed pipeline.')
lines.append("")
lines.append("This module accumulated a lot of small helper functions over time.")
lines.append('"""')
lines.append("")

target_lines = [
    "def dedupe_preserve_order(items):",
    '    """Remove duplicate items from a list, keeping first-occurrence order."""',
    "    seen = []",
    "    result = []",
    "    for item in items:",
    "        if item not in seen:",
    "            result.append(item)",
    "            # BUG: forgot to record `item` as seen, so nothing is ever",
    "            # recognized as a duplicate on later iterations.",
    "    return result",
    "",
    "",
]

filler_count = 0
for i in range(1, NUM_FILLER + 1):
    lines.append(f"def func_{i:04d}(x):")
    lines.append(f'    """Auxiliary helper #{i} (generated filler, not otherwise used)."""')
    lines.append(f"    total = 0")
    lines.append(f"    for step in range({(i % 9) + 1}):")
    lines.append(f"        total += x * step + {i}")
    lines.append(f"    if total % 2 == 0:")
    lines.append(f"        total += {i % 7}")
    lines.append(f"    else:")
    lines.append(f"        total -= {i % 5}")
    lines.append(f"    return total")
    lines.append("")
    lines.append("")
    filler_count += 1
    if filler_count == INSERT_TARGET_AFTER:
        lines.extend(target_lines)

if filler_count < INSERT_TARGET_AFTER:
    lines.extend(target_lines)

with open("bigmod.py", "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"generated bigmod.py with {len(lines)} lines", flush=True)
PYEOF
