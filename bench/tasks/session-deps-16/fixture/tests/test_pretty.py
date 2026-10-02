import pytest
from kit import pretty as M


def test_public_pretty_1():
    assert M.pformat([1, 2, 3]) == '[1, 2, 3]'


def test_public_pretty_2():
    assert M.pformat({'b': 1, 'a': 2}) == "{'a': 2, 'b': 1}"
