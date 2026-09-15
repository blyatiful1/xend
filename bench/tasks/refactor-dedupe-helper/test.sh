#!/usr/bin/env bash
python3 - <<'PYEOF'
import sys

from orders import total_for_member, total_for_guest

failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


items1 = [(10, 3), (20, 2)]
check(total_for_member(items1, 0.1) == 68.04, "total_for_member(items1, 0.1) should be 68.04")
check(total_for_guest(items1, 0.1) == 70.04, "total_for_guest(items1, 0.1) should be 70.04")

items2 = [(50, 3)]  # triggers the >100 bulk discount branch
check(total_for_member(items2, 0.0) == 153.9, "total_for_member(items2, 0.0) should be 153.9")
check(total_for_guest(items2, 0.0) == 155.9, "total_for_guest(items2, 0.0) should be 155.9")

items3 = [(5, 1)]
check(total_for_member(items3, 0.5) == round(5 * 0.5 * 1.08, 2), "total_for_member(items3, 0.5) wrong")
check(
    total_for_guest(items3, 0.5) == round(5 * 0.5 * 1.08 + 2.00, 2),
    "total_for_guest(items3, 0.5) wrong",
)

if failures:
    for f in failures:
        print("FAIL:", f)
    sys.exit(1)

with open("orders.py") as f:
    src = f.read()

import re

def_count = len(re.findall(r'(?m)^def ', src))
if def_count < 3:
    print(f"FAIL: expected a shared helper function to be extracted (found only {def_count} top-level def(s))")
    sys.exit(1)

dup_count = len(re.findall(r'(?i)bulk discount', src))
if dup_count > 1:
    print(f"FAIL: bulk-discount calculation still appears duplicated ({dup_count} occurrences)")
    sys.exit(1)

subtotal_calc_count = len(re.findall(r'subtotal\s*[*]?=\s*subtotal\s*\*\s*0\.95', src))
if subtotal_calc_count > 1:
    print(f"FAIL: the 0.95 bulk-discount line still appears {subtotal_calc_count} times (not deduplicated)")
    sys.exit(1)

print("PASS")
PYEOF
exit $?
