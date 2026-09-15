from pricing.core import calc_total


def invoice_amount(base_amount, tax_rate):
    return calc_total(base_amount, tax_rate)
