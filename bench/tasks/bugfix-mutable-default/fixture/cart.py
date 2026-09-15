def add_item(name, qty, cart=[]):
    """Add an (name, qty) item to cart and return the cart.

    If cart is not given, a fresh cart should be used for each call.
    """
    cart.append((name, qty))
    return cart
