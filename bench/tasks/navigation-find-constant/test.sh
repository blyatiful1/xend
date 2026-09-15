#!/usr/bin/env bash
python3 - <<'PYEOF'
import importlib
import sys

sys.path.insert(0, ".")

import client
importlib.reload(client)

calls = {"n": 0}


def always_fail():
    calls["n"] += 1
    raise ValueError("boom")


try:
    client.fetch_with_retries(always_fail)
    print("FAIL: expected the final exception to propagate")
    sys.exit(1)
except ValueError:
    pass

if calls["n"] != 5:
    print(f"FAIL: expected fetch_with_retries to attempt 5 times, got {calls['n']}")
    sys.exit(1)

import constants_legacy
importlib.reload(constants_legacy)
if constants_legacy.MAX_RETRIES != 3:
    print(f"FAIL: constants_legacy.MAX_RETRIES should stay 3 (unrelated), got {constants_legacy.MAX_RETRIES}")
    sys.exit(1)

import config
importlib.reload(config)
if config.MAX_RETRIES != 3:
    print(f"FAIL: config.MAX_RETRIES should stay 3 (unrelated), got {config.MAX_RETRIES}")
    sys.exit(1)

print("PASS")
PYEOF
exit $?
