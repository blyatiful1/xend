#!/usr/bin/env bash
if python3 -c "import pytest" >/dev/null 2>&1; then
  out=$(python3 -m pytest -q test_paginate.py 2>&1)
elif command -v pytest >/dev/null 2>&1; then
  out=$(pytest -q test_paginate.py 2>&1)
else
  out=$(python3 -m unittest test_paginate -v 2>&1)
fi
rc=$?
if [ $rc -ne 0 ]; then
  echo "FAIL: test_paginate.py did not pass (exit $rc): $(echo "$out" | tail -5)"
  exit 1
fi
echo "PASS"
exit 0
