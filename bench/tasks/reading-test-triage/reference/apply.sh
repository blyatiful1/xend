#!/usr/bin/env bash
cat > calc_pkg/mathutils.py <<'PYEOF'
def add(a, b):
    return a + b


def multiply(a, b):
    return a * b


def is_even(n):
    return n % 2 == 0


def is_leap_year(year):
    """Return True if `year` is a leap year (Gregorian calendar rules)."""
    if year % 400 == 0:
        return True
    if year % 100 == 0:
        return False
    if year % 4 == 0:
        return True
    return False


def reverse_string(s):
    return s[::-1]


def max_of_three(a, b, c):
    return max(a, b, c)
PYEOF
