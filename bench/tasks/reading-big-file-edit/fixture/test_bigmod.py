import unittest

from bigmod import dedupe_preserve_order


class TestDedupe(unittest.TestCase):
    def test_removes_duplicates(self):
        self.assertEqual(
            dedupe_preserve_order([1, 2, 2, 3, 1, 4, 3, 3]),
            [1, 2, 3, 4],
        )

    def test_preserves_first_occurrence_order(self):
        self.assertEqual(
            dedupe_preserve_order(["b", "a", "b", "c", "a"]),
            ["b", "a", "c"],
        )

    def test_empty(self):
        self.assertEqual(dedupe_preserve_order([]), [])

    def test_no_duplicates(self):
        self.assertEqual(dedupe_preserve_order([1, 2, 3]), [1, 2, 3])

    def test_many_repeats(self):
        self.assertEqual(dedupe_preserve_order([5] * 10 + [6] * 5), [5, 6])


if __name__ == "__main__":
    unittest.main()
