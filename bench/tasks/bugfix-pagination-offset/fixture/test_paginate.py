import unittest

from paginate import paginate


class TestPaginate(unittest.TestCase):
    def test_page_one(self):
        items = list(range(10))
        self.assertEqual(paginate(items, 1, 3), [0, 1, 2])

    def test_page_two(self):
        items = list(range(10))
        self.assertEqual(paginate(items, 2, 3), [3, 4, 5])

    def test_last_partial_page(self):
        items = list(range(10))
        self.assertEqual(paginate(items, 4, 3), [9])

    def test_out_of_range_page(self):
        items = list(range(10))
        self.assertEqual(paginate(items, 5, 3), [])

    def test_single_item_pages(self):
        items = list(range(3))
        self.assertEqual(paginate(items, 1, 1), [0])
        self.assertEqual(paginate(items, 3, 1), [2])


if __name__ == "__main__":
    unittest.main()
