from config import MAX_RETRIES as _UNUSED_IMPORT  # kept for backwards compat, not used below

# The actual retry budget used by fetch_with_retries.
MAX_RETRIES = 3


def fetch_with_retries(fetch_fn):
    """Call fetch_fn() up to MAX_RETRIES times, re-raising the last error."""
    attempts = 0
    last_exc = None
    while attempts < MAX_RETRIES:
        attempts += 1
        try:
            return fetch_fn()
        except Exception as e:
            last_exc = e
    raise last_exc
