#!/usr/bin/env bash
cat > .xend_answer.txt <<'TXT'
The bug is in pricing.py, in the function apply_bulk_discount. The hunk
changes the boundary check from `if quantity <= discount_threshold:` to
`if quantity < discount_threshold:`. That flips the behavior exactly at
quantity == discount_threshold: previously an order with quantity equal to
the threshold got no discount (fell into the "no discount" branch), but
after the change it now falls through to the discount branch and
incorrectly receives the bulk discount. The other files in the diff
(auth.py, cache.py, db.py, email_utils.py, queue.py, search.py, utils.py)
only contain cosmetic renames (total -> result) and review comments; they
are not buggy.
TXT
