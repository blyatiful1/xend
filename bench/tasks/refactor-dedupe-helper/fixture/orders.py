def total_for_member(items, discount_rate):
    subtotal = sum(price * qty for price, qty in items)
    if subtotal > 100:
        subtotal = subtotal * 0.95  # bulk discount
    discounted = subtotal * (1 - discount_rate)
    tax = discounted * 0.08
    return round(discounted + tax, 2)


def total_for_guest(items, discount_rate):
    subtotal = sum(price * qty for price, qty in items)
    if subtotal > 100:
        subtotal = subtotal * 0.95  # bulk discount
    discounted = subtotal * (1 - discount_rate)
    tax = discounted * 0.08
    service_fee = 2.00
    return round(discounted + tax + service_fee, 2)
