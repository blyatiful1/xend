#!/usr/bin/env bash
# Copies the hidden test suite into the work dir and runs it against
# whatever the agent (or reference/apply.sh) put under ./logpipe.
set -u

TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOTAL=58

rm -rf ./.xend_hidden_tests
mkdir -p ./.xend_hidden_tests
cp "$TASK_DIR"/hidden/*.py ./.xend_hidden_tests/

run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 300 "$@"
  else
    "$@"
  fi
}

out=$(run_with_timeout python3 -m pytest -q -p no:cacheprovider --continue-on-collection-errors .xend_hidden_tests 2>&1)
rc=$?

# Parse the pytest summary line, e.g.:
#   "3 failed, 55 passed in 0.42s"
#   "58 passed in 0.31s"
#   "5 error(s) in 0.10s"  (collection/import error -> 0 passed)
passed=0
summary_line=$(echo "$out" | grep -E "^[0-9]+ (passed|failed|error|skipped|xfailed|xpassed)" | tail -1)
if [ -n "$summary_line" ]; then
  # count passes even when other tests failed or errored ("2 failed, 1 error, 57 passed")
  passed=$(echo "$summary_line" | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+" || echo 0)
  if [ -z "$passed" ]; then
    passed=0
  fi
else
  passed=0
fi

# Print at most ~40 lines of pytest output (tail), then the SCORE line.
echo "$out" | tail -40

rm -rf ./.xend_hidden_tests

echo "SCORE: ${passed}/${TOTAL}"

if [ "$rc" -eq 0 ] && [ "$passed" -eq "$TOTAL" ]; then
  exit 0
fi
exit 1
