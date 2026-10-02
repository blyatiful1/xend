import pytest
from kit import heap as M


def test_public_heap_1():
    assert M.nsmallest(2, [5, 1, 4]) == [1, 4]


def test_public_heap_2():
    assert list(M.merge([1, 4, 7], [2, 5, 8], [3, 6, 9])) == [1, 2, 3, 4, 5, 6, 7, 8, 9]
