#!/usr/bin/env bash
python3 - <<'PYEOF'
import os
import re
import sys

old_name_found = []
for root, dirs, files in os.walk("pricing"):
    for fn in files:
        if fn.endswith(".py"):
            path = os.path.join(root, fn)
            with open(path) as f:
                content = f.read()
            if re.search(r'\bcalc_total\b', content):
                old_name_found.append(path)

if old_name_found:
    print("FAIL: old name calc_total still present in: " + ", ".join(old_name_found))
    sys.exit(1)

sys.path.insert(0, ".")
try:
    from pricing.core import compute_total_with_tax
except ImportError as e:
    print("FAIL: pricing.core.compute_total_with_tax is not importable:", e)
    sys.exit(1)

if compute_total_with_tax(100, 0.1) != 110.0:
    print("FAIL: compute_total_with_tax(100, 0.1) should be 110.0")
    sys.exit(1)

try:
    from pricing.order import build_order_total
    from pricing.invoice import invoice_amount
    from pricing.report import summarize
except ImportError as e:
    print("FAIL: could not import from pricing.order/invoice/report:", e)
    sys.exit(1)

expected = round(40 * 1.1, 2)
got = build_order_total([(10, 2), (5, 4)], 0.1)
if got != expected:
    print(f"FAIL: build_order_total wrong, got {got} expected {expected}")
    sys.exit(1)

got = invoice_amount(200, 0.05)
if got != round(210.0, 2):
    print(f"FAIL: invoice_amount wrong, got {got}")
    sys.exit(1)

s = summarize(100, 0.2)
if "120.00" not in s:
    print(f"FAIL: summarize wrong: {s!r}")
    sys.exit(1)

print("PASS")
PYEOF
exit $?
