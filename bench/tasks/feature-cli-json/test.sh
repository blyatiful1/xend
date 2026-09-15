#!/usr/bin/env bash
python3 - <<'PYEOF'
import json
import subprocess
import sys

sample_text = "one two three\nfour five\nsix\n"
with open(".hidden_sample.txt", "w") as f:
    f.write(sample_text)

expected = {
    "lines": len(sample_text.splitlines()),
    "words": len(sample_text.split()),
    "chars": len(sample_text),
}

# Plain-text mode must still work as before.
out = subprocess.run(
    [sys.executable, "wc_cli.py", ".hidden_sample.txt"], capture_output=True, text=True
)
if out.returncode != 0:
    print("FAIL: plain invocation exited non-zero:", out.stderr)
    sys.exit(1)
if (
    f"lines: {expected['lines']}" not in out.stdout
    or f"words: {expected['words']}" not in out.stdout
    or f"chars: {expected['chars']}" not in out.stdout
):
    print("FAIL: plain text output missing or wrong:", out.stdout)
    sys.exit(1)

# --json mode.
out2 = subprocess.run(
    [sys.executable, "wc_cli.py", "--json", ".hidden_sample.txt"],
    capture_output=True,
    text=True,
)
if out2.returncode != 0:
    print("FAIL: --json invocation exited non-zero:", out2.stderr)
    sys.exit(1)
stdout = out2.stdout.strip()
try:
    data = json.loads(stdout)
except Exception as e:
    print("FAIL: --json stdout is not valid JSON:", repr(stdout), e)
    sys.exit(1)
if set(data.keys()) != {"lines", "words", "chars"}:
    print("FAIL: json keys wrong, got:", sorted(data.keys()))
    sys.exit(1)
if data != expected:
    print("FAIL: json values wrong, got", data, "expected", expected)
    sys.exit(1)

# Flag order should not matter.
out3 = subprocess.run(
    [sys.executable, "wc_cli.py", ".hidden_sample.txt", "--json"],
    capture_output=True,
    text=True,
)
if out3.returncode != 0 or json.loads(out3.stdout.strip()) != expected:
    print("FAIL: --json after the path argument did not work:", out3.stdout, out3.stderr)
    sys.exit(1)

print("PASS")
PYEOF
exit $?
