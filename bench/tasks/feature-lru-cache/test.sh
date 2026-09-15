#!/usr/bin/env bash
python3 - <<'PYEOF'
import sys

from lru_cache import LRUCache

failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


c = LRUCache(2)
check(len(c) == 0, "new cache should have length 0")
c.put(1, 'a')
c.put(2, 'b')
check(len(c) == 2, "cache should have 2 entries after 2 puts")
check(c.get(1) == 'a', "get(1) should return 'a'")
c.put(3, 'c')  # capacity 2: should evict key 2 (LRU, since 1 was just used)
check(c.get(2) == -1, "key 2 should have been evicted")
check(c.get(3) == 'c', "get(3) should return 'c'")
check(c.get(1) == 'a', "key 1 should still be present")
c.put(4, 'd')  # should evict key 3 now (1 is MRU from the get above, 3 is LRU)
check(c.get(3) == -1, "key 3 should have been evicted")
check(c.get(1) == 'a', "key 1 should still be present")
check(c.get(4) == 'd', "get(4) should return 'd'")
check(len(c) == 2, "cache should stay at capacity 2")

c2 = LRUCache(1)
c2.put('x', 1)
c2.put('y', 2)
check(c2.get('x') == -1, "capacity-1 cache should evict previous key on put")
check(c2.get('y') == 2, "capacity-1 cache should keep the latest key")

# Updating an existing key counts as a use and should not evict it.
c3 = LRUCache(2)
c3.put('a', 1)
c3.put('b', 2)
c3.put('a', 10)  # update a -> a becomes MRU
c3.put('c', 3)  # should evict b, not a
check(c3.get('b') == -1, "b should have been evicted after a was refreshed")
check(c3.get('a') == 10, "a's value should be updated to 10")
check(c3.get('c') == 3, "c should be present")

if failures:
    for f in failures:
        print("FAIL:", f)
    sys.exit(1)
print("PASS")
PYEOF
exit $?
