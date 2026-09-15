#!/usr/bin/env bash
cat > orders.py <<'PYEOF'
def _price_with_tax(items, discount_rate):
    subtotal = sum(price * qty for price, qty in items)
    if subtotal > 100:
        subtotal = subtotal * 0.95  # bulk discount
    discounted = subtotal * (1 - discount_rate)
    tax = discounted * 0.08
    return discounted + tax


def total_for_member(items, discount_rate):
    return round(_price_with_tax(items, discount_rate), 2)


def total_for_guest(items, discount_rate):
    service_fee = 2.00
    return round(_price_with_tax(items, discount_rate) + service_fee, 2)
PYEOF
