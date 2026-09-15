#!/usr/bin/env bash
python3 - <<'PYEOF'
templates = [
    "INFO  orders-api: handled GET /orders/{n} in {ms}ms",
    "INFO  orders-api: handled POST /orders in {ms}ms",
    "DEBUG orders-api: cache hit for order {n}",
    "DEBUG orders-api: cache miss for order {n}, loading from db",
    "INFO  orders-api: health check ok",
    "WARN  orders-api: slow query for order {n} ({ms}ms)",
    "DEBUG orders-api: connection pool size=10 in-use={inuse}",
    "INFO  orders-api: shipped notification for order {n}",
]

TOTAL_LINES = 4000
ERROR_AT = 2517  # 1-indexed line number of the start of the ERROR block

lines = []
n = 0
while len(lines) < TOTAL_LINES:
    lineno = len(lines) + 1
    if lineno == ERROR_AT:
        ts = "2026-09-10T02:14:33Z"
        lines.append(f"{ts} ERROR orders-api: database connection timed out after 5.02s (configured timeout_seconds=5)")
        lines.append(f"{ts} ERROR orders-api: runbook RB-402: primary DB pool requires timeout_seconds >= 30; current value (5) is far too low for this workload")
        lines.append(f"{ts} WARN  orders-api: retrying with backoff, 2 attempts remaining")
        continue
    n += 1
    tmpl = templates[n % len(templates)]
    ms = 5 + (n * 7) % 240
    inuse = n % 10
    order_n = 10000 + (n * 13) % 9000
    ts = f"2026-09-10T02:{(n // 60) % 60:02d}:{n % 60:02d}Z"
    msg = tmpl.format(n=order_n, ms=ms, inuse=inuse)
    lines.append(f"{ts} {msg}")

import os
os.makedirs("logs", exist_ok=True)
with open("logs/app.log", "w") as f:
    f.write("\n".join(lines[:TOTAL_LINES]) + "\n")
PYEOF
