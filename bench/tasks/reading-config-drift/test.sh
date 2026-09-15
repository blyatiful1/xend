#!/usr/bin/env bash
python3 - <<'PYEOF'
import sys

DRIFT_KEYS = {"feature_flag_0042", "limit_0007", "timeout_0003"}
EXEMPT_KEYS = {"environment", "hostname", "region", "replica_count", "log_level"}
PROD_EXEMPT_EXPECTED = {
    "environment": "production",
    "hostname": "prod-01.internal",
    "region": "us-east-1",
    "replica_count": "12",
    "log_level": "warning",
}


def load(path):
    d = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.rstrip("\n")
                s = line.strip()
                if not s or s.startswith("#") or ":" not in line:
                    continue
                k, v = line.split(":", 1)
                d[k.strip()] = v.strip()
    except FileNotFoundError:
        print(f"FAIL: {path} not found")
        sys.exit(1)
    return d


staging = load("config/staging.yaml")
prod = load("config/prod.yaml")

errors = []

for key, sv in staging.items():
    if key in EXEMPT_KEYS or key in DRIFT_KEYS:
        continue
    pv = prod.get(key)
    if pv != sv:
        errors.append(f"{key}: staging={sv} prod={pv} (should match)")

for key in DRIFT_KEYS:
    sv = staging.get(key)
    pv = prod.get(key)
    if sv != pv:
        errors.append(f"DRIFT NOT FIXED {key}: staging={sv} prod={pv}")

for key, expected in PROD_EXEMPT_EXPECTED.items():
    pv = prod.get(key)
    if pv != expected:
        errors.append(f"exempt key changed unexpectedly {key}: prod={pv} expected={expected}")

if len(prod) < 300:
    errors.append(f"config/prod.yaml looks truncated ({len(prod)} keys parsed)")

if errors:
    print("FAIL:", "; ".join(errors[:6]))
    sys.exit(1)

print("PASS")
PYEOF
exit $?
