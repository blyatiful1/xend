def add(a, b):
    return a + b


def multiply(a, b):
    return a * b


def is_even(n):
    return n % 2 == 0


def is_leap_year(year):
    """Return True if `year` is a leap year (Gregorian calendar rules)."""
    # BUG: this is missing the "divisible by 100 but not by 400" exception,
    # e.g. 1900 and 2100 are NOT leap years even though they're divisible by 4.
    if year % 4 == 0:
        return True
    return False


def reverse_string(s):
    return s[::-1]


def max_of_three(a, b, c):
    return max(a, b, c)
