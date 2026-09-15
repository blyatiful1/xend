#!/usr/bin/env bash
cat > cart.py <<'PYEOF'
def add_item(name, qty, cart=None):
    """Add an (name, qty) item to cart and return the cart.

    If cart is not given, a fresh cart should be used for each call.
    """
    if cart is None:
        cart = []
    cart.append((name, qty))
    return cart
PYEOF
