def paginate(items, page, page_size):
    """Return the slice of items for the given 1-indexed page.

    page=1 should return the first page_size items, page=2 the next
    page_size items, and so on. A page beyond the end of items returns
    an empty list.
    """
    start = page * page_size
    end = start + page_size
    return items[start:end]
