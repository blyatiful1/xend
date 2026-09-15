#!/usr/bin/env bash
if python3 -c "import pytest" >/dev/null 2>&1; then
  out=$(python3 -m pytest -q test_analytics.py 2>&1)
elif command -v pytest >/dev/null 2>&1; then
  out=$(pytest -q test_analytics.py 2>&1)
else
  out=$(python3 -m unittest test_analytics -v 2>&1)
fi
rc=$?
if [ $rc -ne 0 ]; then
  echo "FAIL: test_analytics.py did not fully pass (exit $rc): $(echo "$out" | tail -8)"
  exit 1
fi

if grep -n 'print(' analytics.py >/dev/null 2>&1; then
  echo "FAIL: analytics.py still contains leftover print( debugging statements"
  exit 1
fi

echo "PASS"
exit 0
