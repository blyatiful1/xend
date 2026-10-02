import pytest
from kit import pretty as M


def test_hidden_pretty_1():
    assert M.pformat([1, 2, 3]) == '[1, 2, 3]'


def test_hidden_pretty_2():
    assert M.pformat({'b': 1, 'a': 2}) == "{'a': 2, 'b': 1}"


def test_hidden_pretty_3():
    assert M.pformat({'z': 0, 'y': 1, 'x': 2}) == "{'x': 2, 'y': 1, 'z': 0}"


def test_hidden_pretty_4():
    assert M.pformat({'a': {'d': 1, 'c': 2}}) == "{'a': {'c': 2, 'd': 1}}"


def test_hidden_pretty_5():
    assert M.pformat({'b': 1, 'a': 2}, sort_dicts=False) == "{'b': 1, 'a': 2}"


def test_hidden_pretty_6():
    assert M.pformat(list(range(30)), width=20) == '[0,\n 1,\n 2,\n 3,\n 4,\n 5,\n 6,\n 7,\n 8,\n 9,\n 10,\n 11,\n 12,\n 13,\n 14,\n 15,\n 16,\n 17,\n 18,\n 19,\n 20,\n 21,\n 22,\n 23,\n 24,\n 25,\n 26,\n 27,\n 28,\n 29]'


def test_hidden_pretty_7():
    assert M.pformat({3: 'a', 1: 'b', 2: 'c'}) == "{1: 'b', 2: 'c', 3: 'a'}"


def test_hidden_pretty_8():
    assert M.pformat({'k': [1, 2], 'j': 'v'}, width=10) == "{'j': 'v',\n 'k': [1,\n       2]}"
