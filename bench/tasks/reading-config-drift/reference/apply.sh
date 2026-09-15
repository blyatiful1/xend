#!/usr/bin/env bash
python3 - <<'PYEOF'
DRIFT_KEYS = {"feature_flag_0042", "limit_0007", "timeout_0003"}

with open("config/staging.yaml") as f:
    staging_lines = f.readlines()

staging_vals = {}
for line in staging_lines:
    if ":" in line and not line.strip().startswith("#"):
        k, v = line.split(":", 1)
        staging_vals[k.strip()] = v.strip()

with open("config/prod.yaml") as f:
    prod_lines = f.readlines()

out = []
for line in prod_lines:
    if ":" in line and not line.strip().startswith("#"):
        k, v = line.split(":", 1)
        key = k.strip()
        if key in DRIFT_KEYS:
            out.append(f"{key}: {staging_vals[key]}\n")
            continue
    out.append(line)

with open("config/prod.yaml", "w") as f:
    f.writelines(out)
PYEOF
