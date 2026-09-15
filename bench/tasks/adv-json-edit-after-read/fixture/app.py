"""app.py - loads settings.json and derives a few runtime values from it."""

import json


def load_settings(path="settings.json"):
    with open(path) as f:
        return json.load(f)


def build_retry_delays():
    """Return the sleep delay (seconds) before each retry attempt.

    Delay before retry i (1-indexed) is backoff_base * 2**(i - 1).
    """
    cfg = load_settings()
    retries = cfg["network"]["retries"]
    backoff_base = cfg["network"]["backoff_base"]
    return [backoff_base * (2 ** i) for i in range(retries)]


def total_timeout_budget_seconds():
    cfg = load_settings()
    return cfg["network"]["timeout_seconds"] + sum(build_retry_delays())
