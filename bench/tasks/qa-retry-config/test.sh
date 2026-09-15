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


def has_number_near(text, number_str, spelled, context_words, window=40):
    for m in re.finditer(re.escape(number_str), text):
        s = max(0, m.start() - window)
        e = min(len(text), m.end() + window)
        ctx = text[s:e]
        if any(w in ctx for w in context_words):
            return True
    if spelled and spelled in text:
        return True
    return False


ok_total = "14" in a
ok_retries = has_number_near(a, "3", "three", ["retr", "attempt"])
ok_base = has_number_near(a, "2", "two", ["backoff", "base", "second", "sec"])

missing = []
if not ok_total:
    missing.append("max total wait time (14 seconds)")
if not ok_retries:
    missing.append("number of retries (3)")
if not ok_base:
    missing.append("backoff base (2 seconds)")

if missing:
    print("FAIL: answer is missing: " + ", ".join(missing))
    sys.exit(1)

print("PASS")
PYEOF
exit $?
