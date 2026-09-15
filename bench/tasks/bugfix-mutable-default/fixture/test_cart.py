import unittest

from cart import add_item


class TestCart(unittest.TestCase):
    def test_explicit_cart_still_works(self):
        cart = []
        add_item('apple', 1, cart)
        add_item('banana', 2, cart)
        self.assertEqual(cart, [('apple', 1), ('banana', 2)])

    def test_independent_calls_do_not_share_state(self):
        cart1 = add_item('banana', 1)
        cart2 = add_item('cherry', 5)
        self.assertEqual(cart2, [('cherry', 5)])

    def test_single_call(self):
        cart = add_item('apple', 2)
        self.assertEqual(cart, [('apple', 2)])


if __name__ == "__main__":
    unittest.main()
