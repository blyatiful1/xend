#!/usr/bin/env bash
python3 - <<'PYEOF'
lines = []
lines.append("import unittest")
lines.append("")
lines.append("from analytics import add, subtract, square, is_positive, clamp, compute_variance")
lines.append("")
lines.append("")
lines.append("class TestAnalytics(unittest.TestCase):")

TRIVIAL_PER_GROUP = 30  # 5 groups * 30 = 150 trivial tests total
idx = 0
trivial_count = 0


def emit_trivial(name, body_lines):
    global idx, trivial_count
    idx += 1
    trivial_count += 1
    lines.append(f"    def test_c{idx:03d}_{name}(self):")
    lines.extend(f"        {b}" for b in body_lines)
    lines.append("")


# --- 30 trivial `add` tests ---
for i in range(TRIVIAL_PER_GROUP):
    a, b = i - 15, i * 2 - 10
    emit_trivial("add", [f"self.assertEqual(add({a}, {b}), {a + b})"])

# --- 30 trivial `subtract` tests ---
for i in range(TRIVIAL_PER_GROUP):
    a, b = i * 3 - 20, i - 5
    emit_trivial("subtract", [f"self.assertEqual(subtract({a}, {b}), {a - b})"])

# --- 30 trivial `square` tests ---
for i in range(TRIVIAL_PER_GROUP):
    x = i - 15
    emit_trivial("square", [f"self.assertEqual(square({x}), {x * x})"])

# --- The one critical test, inserted at index 91 (roughly the middle of ---
# --- the 151 total tests once alphabetically/positionally ordered).    ---
lines.append("    def test_c091_variance_known_case(self):")
lines.append("        # Textbook example: population variance of this dataset is exactly 4.0")
lines.append("        data = [2, 4, 4, 4, 5, 5, 7, 9]")
lines.append("        self.assertAlmostEqual(compute_variance(data), 4.0, places=6)")
lines.append("")
idx += 1  # keep numbering consistent with surrounding trivial tests

# --- 30 trivial `is_positive` tests ---
for i in range(TRIVIAL_PER_GROUP):
    x = i - 15
    emit_trivial("is_positive", [f"self.assertEqual(is_positive({x}), {x > 0})"])

# --- 30 trivial `clamp` tests ---
for i in range(TRIVIAL_PER_GROUP):
    x, lo, hi = i - 10, -5, 20
    emit_trivial("clamp", [f"self.assertEqual(clamp({x}, {lo}, {hi}), {max(lo, min(hi, x))})"])

lines.append("")
lines.append("if __name__ == '__main__':")
lines.append("    unittest.main()")

assert trivial_count == 150, f"expected 150 trivial tests, got {trivial_count}"

with open("test_analytics.py", "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"generated test_analytics.py with {trivial_count} trivial tests + 1 critical test", flush=True)
PYEOF
