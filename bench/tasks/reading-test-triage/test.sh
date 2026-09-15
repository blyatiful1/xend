#!/usr/bin/env bash
run_tests() {
  if python3 -c "import pytest" >/dev/null 2>&1; then
    python3 -m pytest -q tests/
  elif command -v pytest >/dev/null 2>&1; then
    pytest -q tests/
  else
    python3 -m unittest discover -s tests -p "test_*.py"
  fi
}
out=$(run_tests 2>&1)
rc=$?
if [ $rc -ne 0 ]; then
  echo "FAIL: test suite did not fully pass (exit $rc): $(echo "$out" | tail -8)"
  exit 1
fi
echo "PASS"
exit 0
