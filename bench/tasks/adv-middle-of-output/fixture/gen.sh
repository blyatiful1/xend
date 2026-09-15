#!/usr/bin/env bash
python3 - <<'PYEOF'
import os

templates = [
    "INFO  build: compiling module core/{n:04d}.o",
    "INFO  build: linking target lib{n}.so",
    "DEBUG build: cache hit for object {n:04d}.o",
    "DEBUG build: cache miss for object {n:04d}.o, recompiling",
    "INFO  build: running unit test suite chunk {n}",
    "WARN  build: deprecated flag -f{n} used in build rule {n}",
    "DEBUG build: worker pool size=8 in-use={inuse}",
    "INFO  build: packaged asset bundle {n:04d}.tar.gz ({ms}ms)",
    "INFO  build: static analysis pass {n} completed, 0 issues",
    "DEBUG build: resolved dependency graph node {n:04d}",
]

TOTAL_LINES = 6000
ERROR_AT = 3103  # 1-indexed line number where the decisive error block starts

lines = []
n = 0
while len(lines) < TOTAL_LINES:
    lineno = len(lines) + 1
    if lineno == ERROR_AT:
        ts = "2026-09-12T08:41:07Z"
        lines.append(f"{ts} ERROR build: environment variable ARTIFACT_CACHE_TOKEN is not set")
        lines.append(f"{ts} ERROR build: ARTIFACT_CACHE_TOKEN is required to sign build artifacts before upload")
        lines.append(f"{ts} ERROR build: add ARTIFACT_CACHE_TOKEN to config/env.example (see docs/build.md#signing)")
        lines.append(f"{ts} WARN  build: continuing without artifact signing (INSECURE) - CI will reject this build")
        continue
    n += 1
    tmpl = templates[n % len(templates)]
    ms = 8 + (n * 11) % 900
    inuse = n % 8
    ts = f"2026-09-12T08:{(n // 60) % 60:02d}:{n % 60:02d}Z"
    msg = tmpl.format(n=n, ms=ms, inuse=inuse)
    lines.append(f"{ts} {msg}")

os.makedirs("build", exist_ok=True)
with open("build/build.log", "w") as f:
    f.write("\n".join(lines[:TOTAL_LINES]) + "\n")

print(f"generated build/build.log with {len(lines[:TOTAL_LINES])} lines", flush=True)
PYEOF
