import unittest

from app import build_retry_delays, total_timeout_budget_seconds


class TestApp(unittest.TestCase):
    def test_build_retry_delays(self):
        self.assertEqual(build_retry_delays(), [2, 4, 8])

    def test_total_timeout_budget_seconds(self):
        self.assertEqual(total_timeout_budget_seconds(), 30 + 2 + 4 + 8)


if __name__ == "__main__":
    unittest.main()
