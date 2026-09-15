#!/usr/bin/env bash
# Self-validation for the xend bench task suite.
#
# For every task under bench/tasks/<slug>/:
#   1. Copy fixture/ to a temp dir, run gen.sh if present (then delete it),
#      run test.sh with cwd = that temp dir, and require it to FAIL
#      (the task should not already be solved).
#   2. Copy fixture/ to a fresh temp dir, run gen.sh if present (then
#      delete it), run reference/apply.sh with cwd = that temp dir, then
#      run test.sh again and require it to PASS.
#
# Prints a table of results and exits non-zero if any task misbehaves.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASKS_DIR="$SCRIPT_DIR/tasks"

if [ ! -d "$TASKS_DIR" ]; then
  echo "No tasks directory at $TASKS_DIR" >&2
  exit 1
fi

GEN_TIMEOUT=10
TEST_TIMEOUT=40
APPLY_TIMEOUT=40

run_with_timeout() {
  # run_with_timeout <seconds> <cmd...>
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  else
    "$@"
  fi
}

pass_count=0
fail_count=0
declare -a rows=()

for task_dir in "$TASKS_DIR"/*/; do
  slug="$(basename "$task_dir")"
  task_dir="${task_dir%/}"

  errors=()

  # --- basic layout / schema checks ---
  if [ ! -f "$task_dir/task.json" ]; then
    errors+=("missing task.json")
  else
    py_err=$(python3 - "$task_dir/task.json" "$slug" <<'PYEOF'
import json
import sys

path, slug = sys.argv[1], sys.argv[2]
try:
    with open(path) as f:
        data = json.load(f)
except Exception as e:
    print(f"invalid JSON: {e}")
    sys.exit(0)

required = {
    "name": str,
    "category": str,
    "difficulty": int,
    "prompt": str,
    "timeout_s": int,
    "max_turns": int,
}
problems = []
for key, typ in required.items():
    if key not in data:
        problems.append(f"missing key '{key}'")
        continue
    if typ is int and isinstance(data[key], bool):
        problems.append(f"key '{key}' should be int, got bool")
        continue
    if not isinstance(data[key], typ):
        problems.append(f"key '{key}' should be {typ.__name__}")

if data.get("name") != slug:
    problems.append(f"name '{data.get('name')}' does not match directory '{slug}'")

valid_categories = {"bugfix", "feature", "refactor", "reading", "navigation", "qa"}
if data.get("category") not in valid_categories:
    problems.append(f"invalid category '{data.get('category')}'")

if data.get("difficulty") not in (1, 2, 3):
    problems.append(f"invalid difficulty '{data.get('difficulty')}'")

if problems:
    print("; ".join(problems))
PYEOF
)
    if [ -n "$py_err" ]; then
      errors+=("task.json: $py_err")
    fi
  fi

  if [ ! -d "$task_dir/fixture" ]; then
    errors+=("missing fixture/ directory")
  fi
  if [ ! -f "$task_dir/test.sh" ]; then
    errors+=("missing test.sh")
  fi
  if [ ! -f "$task_dir/reference/apply.sh" ]; then
    errors+=("missing reference/apply.sh")
  fi

  # Committed fixture files must be small (gen.sh itself is exempt from the
  # size check only in the sense that it must be small too, but large
  # generated artifacts must not be committed at all).
  if [ -d "$task_dir/fixture" ]; then
    while IFS= read -r f; do
      errors+=("committed fixture file too large (>30KB): ${f#"$task_dir"/}")
    done < <(find "$task_dir/fixture" -type f -size +30k 2>/dev/null)
  fi

  result="OK"
  if [ ${#errors[@]} -gt 0 ]; then
    result="FAIL"
  fi

  before_status="-"
  after_status="-"

  if [ "$result" = "OK" ]; then
    # --- check 1: unsolved fixture must FAIL test.sh ---
    tmp1="$(mktemp -d)"
    cp -r "$task_dir/fixture/." "$tmp1/"
    if [ -f "$tmp1/gen.sh" ]; then
      if ! ( cd "$tmp1" && run_with_timeout "$GEN_TIMEOUT" bash gen.sh ) >/tmp/xend_gen_out_1.$$ 2>&1; then
        errors+=("gen.sh failed (before-fix copy): $(tail -3 /tmp/xend_gen_out_1.$$ | tr '\n' ' ')")
      fi
      rm -f /tmp/xend_gen_out_1.$$
      rm -f "$tmp1/gen.sh"
    fi

    if [ ${#errors[@]} -eq 0 ]; then
      out1=$( cd "$tmp1" && run_with_timeout "$TEST_TIMEOUT" bash "$task_dir/test.sh" 2>&1 )
      rc1=$?
      if [ $rc1 -eq 0 ]; then
        errors+=("test.sh PASSED on the unmodified (buggy) fixture — it should FAIL. Output: $(echo "$out1" | tail -3 | tr '\n' ' ')")
        before_status="FAIL(should-fail)"
      else
        before_status="fails-as-expected"
      fi
    fi
    rm -rf "$tmp1"

    # --- check 2: reference solution must PASS test.sh ---
    tmp2="$(mktemp -d)"
    cp -r "$task_dir/fixture/." "$tmp2/"
    if [ -f "$tmp2/gen.sh" ]; then
      if ! ( cd "$tmp2" && run_with_timeout "$GEN_TIMEOUT" bash gen.sh ) >/tmp/xend_gen_out_2.$$ 2>&1; then
        errors+=("gen.sh failed (after-fix copy): $(tail -3 /tmp/xend_gen_out_2.$$ | tr '\n' ' ')")
      fi
      rm -f /tmp/xend_gen_out_2.$$
      rm -f "$tmp2/gen.sh"
    fi

    if [ -f "$task_dir/reference/apply.sh" ]; then
      apply_out=$( cd "$tmp2" && run_with_timeout "$APPLY_TIMEOUT" bash "$task_dir/reference/apply.sh" 2>&1 )
      apply_rc=$?
      if [ $apply_rc -ne 0 ]; then
        errors+=("reference/apply.sh exited non-zero ($apply_rc): $(echo "$apply_out" | tail -3 | tr '\n' ' ')")
      fi
    fi

    if [ ${#errors[@]} -eq 0 ] || [ "$before_status" = "fails-as-expected" ]; then
      out2=$( cd "$tmp2" && run_with_timeout "$TEST_TIMEOUT" bash "$task_dir/test.sh" 2>&1 )
      rc2=$?
      if [ $rc2 -ne 0 ]; then
        errors+=("test.sh FAILED after applying the reference solution — it should PASS. Output: $(echo "$out2" | tail -5 | tr '\n' ' ')")
        after_status="FAIL(should-pass)"
      else
        after_status="passes-as-expected"
      fi
    fi
    rm -rf "$tmp2"
  fi

  if [ ${#errors[@]} -gt 0 ]; then
    result="FAIL"
  fi

  if [ "$result" = "OK" ]; then
    pass_count=$((pass_count + 1))
  else
    fail_count=$((fail_count + 1))
  fi

  category="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('category','?'))" "$task_dir/task.json" 2>/dev/null || echo "?")"
  difficulty="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('difficulty','?'))" "$task_dir/task.json" 2>/dev/null || echo "?")"

  rows+=("$slug|$category|$difficulty|$result|$before_status|$after_status|$(IFS='; '; echo "${errors[*]:-}")")
done

printf "\n%-32s %-11s %-3s %-6s %-22s %-22s %s\n" "TASK" "CATEGORY" "DIFF" "RESULT" "BEFORE-FIX" "AFTER-FIX" "NOTES"
printf '%s\n' "----------------------------------------------------------------------------------------------------------------------"
for row in "${rows[@]}"; do
  IFS='|' read -r slug category difficulty result before after notes <<< "$row"
  printf "%-32s %-11s %-3s %-6s %-22s %-22s %s\n" "$slug" "$category" "$difficulty" "$result" "$before" "$after" "$notes"
done
echo

echo "Summary: $pass_count/$((pass_count + fail_count)) tasks OK"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
exit 0
