def calc_total(amount, rate):
    """Return amount plus tax at the given rate, rounded to 2 decimals."""
    return round(amount + amount * rate, 2)
