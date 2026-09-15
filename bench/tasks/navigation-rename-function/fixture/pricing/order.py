from pricing.core import calc_total


def build_order_total(items, tax_rate):
    subtotal = sum(price * qty for price, qty in items)
    return calc_total(subtotal, tax_rate)
