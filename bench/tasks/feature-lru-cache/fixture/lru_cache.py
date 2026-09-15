class LRUCache:
    """A fixed-capacity cache that evicts the least recently used entry.

    Required interface:
      LRUCache(capacity: int)          - capacity is a positive integer
      .get(key) -> value               - returns -1 if key is not present;
                                          a successful get marks key as the
                                          most recently used entry
      .put(key, value) -> None         - inserts or updates key, marking it
                                          the most recently used entry; if
                                          the cache is over capacity after
                                          the insert, evict the least
                                          recently used entry first
      len(cache) -> int                - number of entries currently stored
    """

    def __init__(self, capacity):
        raise NotImplementedError("implement LRUCache.__init__")

    def get(self, key):
        raise NotImplementedError("implement LRUCache.get")

    def put(self, key, value):
        raise NotImplementedError("implement LRUCache.put")

    def __len__(self):
        raise NotImplementedError("implement LRUCache.__len__")
