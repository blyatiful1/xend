#!/usr/bin/env bash
cat > .xend_answer.txt <<'TXT'
Retries are configured in http_client.py: request_with_backoff makes the
initial request and, on failure, retries up to MAX_RETRIES = 3 additional
times, using exponential backoff with a base of BACKOFF_BASE_SECONDS = 2
seconds. The sleep before each retry is base * 2**(retry_number - 1), i.e.
2s before retry 1, 4s before retry 2, and 8s before retry 3. If every
attempt fails, the total time spent sleeping between attempts is
2 + 4 + 8 = 14 seconds.
TXT
