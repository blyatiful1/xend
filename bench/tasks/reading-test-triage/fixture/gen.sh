#!/usr/bin/env bash
python3 - <<'PYEOF'
import os
import random
import string

rng = random.Random(1234)

lines = []
lines.append("import os")
lines.append("import sys")
lines.append("import unittest")
lines.append("")
lines.append("sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))")
lines.append("")
lines.append("from calc_pkg.mathutils import (")
lines.append("    add,")
lines.append("    multiply,")
lines.append("    is_even,")
lines.append("    is_leap_year,")
lines.append("    reverse_string,")
lines.append("    max_of_three,")
lines.append(")")
lines.append("")
lines.append("")
lines.append("class TestGenerated(unittest.TestCase):")

idx = 0

# --- add: 20 tests ---
for i in range(20):
    a = rng.randint(-50, 50)
    b = rng.randint(-50, 50)
    idx += 1
    lines.append(f"    def test_add_{idx:03d}(self):")
    lines.append(f"        self.assertEqual(add({a}, {b}), {a + b})")
    lines.append("")

# --- multiply: 20 tests ---
for i in range(20):
    a = rng.randint(-20, 20)
    b = rng.randint(-20, 20)
    idx += 1
    lines.append(f"    def test_multiply_{idx:03d}(self):")
    lines.append(f"        self.assertEqual(multiply({a}, {b}), {a * b})")
    lines.append("")

# --- is_even: 20 tests ---
for i in range(20):
    n = rng.randint(-100, 100)
    idx += 1
    lines.append(f"    def test_is_even_{idx:03d}(self):")
    lines.append(f"        self.assertEqual(is_even({n}), {n % 2 == 0})")
    lines.append("")

# --- is_leap_year: 20 tests, exactly 2 of which hit the century exception ---
years = [
    2000, 2004, 2008, 2012, 2016, 2020, 2024, 2028,
    2001, 2002, 2003, 2005, 2006, 2007, 2009, 2010, 2011,
    1900, 2100,  # the 2 tricky century-but-not-400 years
    2400,
]
assert len(years) == 20
for y in years:
    expected = (y % 400 == 0) or (y % 4 == 0 and y % 100 != 0)
    idx += 1
    lines.append(f"    def test_is_leap_year_{idx:03d}(self):")
    lines.append(f"        self.assertEqual(is_leap_year({y}), {expected})")
    lines.append("")

# --- reverse_string: 20 tests ---
for i in range(20):
    length = rng.randint(1, 10)
    s = "".join(rng.choice(string.ascii_lowercase) for _ in range(length))
    idx += 1
    lines.append(f"    def test_reverse_string_{idx:03d}(self):")
    lines.append(f"        self.assertEqual(reverse_string({s!r}), {s[::-1]!r})")
    lines.append("")

# --- max_of_three: 20 tests ---
for i in range(20):
    a = rng.randint(-30, 30)
    b = rng.randint(-30, 30)
    c = rng.randint(-30, 30)
    idx += 1
    lines.append(f"    def test_max_of_three_{idx:03d}(self):")
    lines.append(f"        self.assertEqual(max_of_three({a}, {b}, {c}), {max(a, b, c)})")
    lines.append("")

lines.append("")
lines.append("if __name__ == '__main__':")
lines.append("    unittest.main()")

assert idx == 120, f"expected 120 generated tests, got {idx}"

os.makedirs("tests", exist_ok=True)
with open("tests/test_generated.py", "w") as f:
    f.write("\n".join(lines) + "\n")
PYEOF
