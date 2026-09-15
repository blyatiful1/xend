#!/usr/bin/env bash
python3 - <<'PYEOF'
import glob
import importlib
import re
import sys

NUM_MODULES = 12

failures = []

# --- 1. fmt.py signature updated ---
try:
    with open("moneymod/fmt.py") as f:
        fmt_src = f.read()
except FileNotFoundError:
    print("FAIL: moneymod/fmt.py not found")
    sys.exit(1)

if not re.search(r'def\s+fmt_money\s*\(\s*x\s*,\s*currency\s*=\s*["\']USD["\']\s*\)', fmt_src):
    failures.append("moneymod/fmt.py: fmt_money signature was not updated to fmt_money(x, currency=\"USD\")")

# --- 2. every call site in every module passes currency= explicitly ---
call_re = re.compile(r'fmt_money\(([^)]*)\)')
module_paths = sorted(glob.glob("moneymod/mod_*.py"))
if len(module_paths) < NUM_MODULES:
    failures.append(f"expected {NUM_MODULES} moneymod/mod_*.py files, found {len(module_paths)}")

for path in module_paths:
    with open(path) as f:
        src = f.read()
    calls = call_re.findall(src)
    if len(calls) < 15:
        failures.append(f"{path}: only {len(calls)} fmt_money( call sites found (expected ~20-25)")
        continue
    missing = sum(1 for c in calls if "currency=" not in c)
    if missing:
        failures.append(f"{path}: {missing} of {len(calls)} call site(s) are missing the currency= kwarg")

if failures:
    for msg in failures:
        print("FAIL:", msg)
    sys.exit(1)

# --- 3. behavior preserved (import every module, call sample functions) ---
sys.path.insert(0, ".")
try:
    import moneymod.fmt as fmt_mod
except Exception as e:
    print(f"FAIL: could not import moneymod.fmt: {e}")
    sys.exit(1)

if fmt_mod.fmt_money(12.5) != "$12.50":
    print(f"FAIL: fmt_money(12.5) default (USD) output changed: {fmt_mod.fmt_money(12.5)!r}")
    sys.exit(1)

for i in range(1, NUM_MODULES + 1):
    modname = f"moneymod.mod_{i:02d}"
    try:
        mod = importlib.import_module(modname)
    except Exception as e:
        print(f"FAIL: could not import {modname}: {e}")
        sys.exit(1)

    for fn_name in ("line_001", "line_020"):
        fn = getattr(mod, fn_name, None)
        if fn is None:
            continue
        try:
            result = fn(10)
        except Exception as e:
            print(f"FAIL: {modname}.{fn_name}(10) raised {type(e).__name__}: {e}")
            sys.exit(1)
        if result != "$10.00":
            print(f"FAIL: {modname}.{fn_name}(10) returned {result!r}, expected '$10.00' (behavior changed)")
            sys.exit(1)

print("PASS")
PYEOF
exit $?
