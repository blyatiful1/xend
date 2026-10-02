import pytest
from kit import wrap as M


def test_public_wrap_1():
    assert M.wrap('the quick brown fox jumps over', width=10) == ['the quick', 'brown fox', 'jumps over']


def test_public_wrap_2():
    assert M.wrap('abcdefghij', width=4) == ['abcd', 'efgh', 'ij']
