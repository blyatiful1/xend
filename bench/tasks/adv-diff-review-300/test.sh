#!/usr/bin/env bash
python3 - <<'PYEOF'
import re
import sys

try:
    with open(".xend_answer.txt") as f:
        answer = f.read()
except FileNotFoundError:
    print("FAIL: .xend_answer.txt not found")
    sys.exit(1)

a = answer.lower()

BUGGY_FILE_RE = re.compile(r'\bpricing(\.py)?\b')
BUGGY_FUNC_RE = re.compile(r'\bapply_bulk_discount\b')
CLEAN_FILES = ["auth", "cache", "db", "email_utils", "queue", "search", "utils"]


def flagged_as_buggy(text, filename, window=60):
    """True if `filename` appears near the word 'bug' (or 'buggy')."""
    for m in re.finditer(re.escape(filename), text):
        s = max(0, m.start() - window)
        e = min(len(text), m.end() + window)
        ctx = text[s:e]
        if "bug" in ctx:
            return True
    return False


missing = []
if not BUGGY_FILE_RE.search(a):
    missing.append("the buggy file name (pricing.py)")
if not BUGGY_FUNC_RE.search(a):
    missing.append("the buggy function name (apply_bulk_discount)")

if missing:
    print("FAIL: answer is missing: " + ", ".join(missing))
    sys.exit(1)

flagged_clean = [f for f in CLEAN_FILES if flagged_as_buggy(a, f)]
if len(flagged_clean) == len(CLEAN_FILES):
    print(
        "FAIL: answer flags every other (clean) file as buggy too - it must specifically "
        "identify pricing.py, not just list all files as suspect"
    )
    sys.exit(1)

print("PASS")
PYEOF
exit $?
