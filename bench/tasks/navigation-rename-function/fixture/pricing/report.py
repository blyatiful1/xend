from pricing.core import calc_total


def summarize(amount, tax_rate):
    total = calc_total(amount, tax_rate)
    return f"Total due: {total:.2f}"
