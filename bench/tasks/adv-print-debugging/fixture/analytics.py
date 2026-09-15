"""analytics.py - small statistics helpers used by the reporting pipeline."""


def add(a, b):
    return a + b


def subtract(a, b):
    return a - b


def square(x):
    return x * x


def is_positive(x):
    return x > 0


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def mean(values):
    """Arithmetic mean of a non-empty list of numbers."""
    return sum(values) / len(values)


def compute_variance(values):
    """Population variance of a non-empty list of numbers."""
    m = mean(values)
    deviations = [v - m for v in values]
    # BUG: this squares the *sum* of the deviations instead of summing the
    # *squares* of the deviations. Since deviations from the mean always
    # sum to (approximately) zero, this collapses the variance to ~0.
    return sum(deviations) ** 2 / len(values)


def compute_std(values):
    """Population standard deviation of a non-empty list of numbers."""
    return compute_variance(values) ** 0.5


def z_scores(values):
    """Return the z-score of each value in `values`."""
    m = mean(values)
    s = compute_std(values)
    if s == 0:
        return [0.0 for _ in values]
    return [round((v - m) / s, 4) for v in values]
