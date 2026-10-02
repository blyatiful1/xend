import pytest
from kit import heap as M


def test_hidden_heap_1():
    assert M.nsmallest(2, [5, 1, 4]) == [1, 4]


def test_hidden_heap_2():
    assert list(M.merge([1, 4, 7], [2, 5, 8], [3, 6, 9])) == [1, 2, 3, 4, 5, 6, 7, 8, 9]


def test_hidden_heap_3():
    assert list(M.merge([1, 3], [2, 4])) == [1, 2, 3, 4]


def test_hidden_heap_4():
    assert list(M.merge([], [1], [0, 2])) == [0, 1, 2]


def test_hidden_heap_5():
    assert list(M.merge([5, 3, 1], [4, 2], reverse=True)) == [5, 4, 3, 2, 1]


def test_hidden_heap_6():
    assert list(M.merge(['bb', 'a'], ['ccc'], key=len)) == ['bb', 'a', 'ccc']


def test_hidden_heap_7():
    assert list(M.merge([1, 2, 3])) == [1, 2, 3]


def test_hidden_heap_8():
    assert M.nlargest(3, [4, 9, 1, 7]) == [9, 7, 4]
