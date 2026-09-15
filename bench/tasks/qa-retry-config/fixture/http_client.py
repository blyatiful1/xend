import time

MAX_RETRIES = 3
BACKOFF_BASE_SECONDS = 2


def request_with_backoff(send_fn, sleep_fn=time.sleep):
    """Call send_fn(). On failure, retry up to MAX_RETRIES additional times.

    Before each retry, sleep for BACKOFF_BASE_SECONDS * 2**(retry_number - 1)
    seconds (exponential backoff): 2s before retry 1, 4s before retry 2, and
    8s before retry 3. If every attempt (the initial one plus all retries)
    fails, the last exception is re-raised after the final retry.
    """
    try:
        return send_fn()
    except Exception as first_exc:
        last_exc = first_exc

    for retry_number in range(1, MAX_RETRIES + 1):
        sleep_fn(BACKOFF_BASE_SECONDS * (2 ** (retry_number - 1)))
        try:
            return send_fn()
        except Exception as e:
            last_exc = e

    raise last_exc
