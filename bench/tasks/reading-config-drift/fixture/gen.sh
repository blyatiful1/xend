#!/usr/bin/env bash
python3 - <<'PYEOF'
import hashlib
import os


def stable_int(s):
    return int(hashlib.sha256(s.encode()).hexdigest(), 16)


def baseline(key, kind):
    h = stable_int("v2:" + key)
    if kind == "bool":
        return h % 2 == 0
    return 10 + (h % 990)


def fmt(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


keys = []
for i in range(1, 251):
    keys.append((f"feature_flag_{i:04d}", "bool"))
for i in range(1, 41):
    keys.append((f"limit_{i:04d}", "int"))
for i in range(1, 11):
    keys.append((f"timeout_{i:04d}", "int"))

DRIFT_KEYS = {"feature_flag_0042", "limit_0007", "timeout_0003"}

EXEMPT = {
    "environment": {"dev": "development", "staging": "staging", "prod": "production"},
    "hostname": {"dev": "dev-01.internal", "staging": "staging-01.internal", "prod": "prod-01.internal"},
    "region": {"dev": "us-west-2", "staging": "us-west-2", "prod": "us-east-1"},
    "replica_count": {"dev": "1", "staging": "2", "prod": "12"},
    "log_level": {"dev": "debug", "staging": "info", "prod": "warning"},
}


def write_env(env_name):
    lines = [f"# {env_name} environment configuration (generated)"]
    for key, envs in EXEMPT.items():
        lines.append(f"{key}: {envs[env_name]}")
    for key, kind in keys:
        value = baseline(key, kind)
        if env_name == "prod" and key in DRIFT_KEYS:
            if kind == "bool":
                value = not value
            else:
                value = value + 5
        lines.append(f"{key}: {fmt(value)}")
    os.makedirs("config", exist_ok=True)
    with open(f"config/{env_name}.yaml", "w") as f:
        f.write("\n".join(lines) + "\n")


for env_name in ("dev", "staging", "prod"):
    write_env(env_name)
PYEOF
