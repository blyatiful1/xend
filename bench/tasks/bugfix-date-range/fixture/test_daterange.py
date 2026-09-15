import unittest
from datetime import date

from daterange import in_range


class TestInRange(unittest.TestCase):
    def test_start_boundary_included(self):
        self.assertTrue(in_range(date(2024, 1, 1), date(2024, 1, 1), date(2024, 1, 31)))

    def test_end_boundary_included(self):
        self.assertTrue(in_range(date(2024, 1, 31), date(2024, 1, 1), date(2024, 1, 31)))

    def test_middle_of_range(self):
        self.assertTrue(in_range(date(2024, 1, 15), date(2024, 1, 1), date(2024, 1, 31)))

    def test_before_range(self):
        self.assertFalse(in_range(date(2023, 12, 31), date(2024, 1, 1), date(2024, 1, 31)))

    def test_after_range(self):
        self.assertFalse(in_range(date(2024, 2, 1), date(2024, 1, 1), date(2024, 1, 31)))

    def test_single_day_range(self):
        self.assertTrue(in_range(date(2024, 5, 5), date(2024, 5, 5), date(2024, 5, 5)))


if __name__ == "__main__":
    unittest.main()
