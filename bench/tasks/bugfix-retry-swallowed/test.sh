#!/usr/bin/env bash
out=$(node retry.test.js 2>&1)
rc=$?
if [ $rc -ne 0 ]; then
  echo "FAIL: retry.test.js did not pass (exit $rc): $(echo "$out" | tail -5)"
  exit 1
fi
echo "PASS"
exit 0
