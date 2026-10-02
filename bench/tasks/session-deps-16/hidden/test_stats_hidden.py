import pytest
from kit import stats as M


def test_hidden_stats_1():
    assert M.median([1, 3, 5, 7]) == 4.0


def test_hidden_stats_2():
    assert M.quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], n=4) == [2.75, 5.5, 8.25]


def test_hidden_stats_3():
    assert M.quantiles([10, 20, 30, 40, 50], n=10) == [6.0, 12.0, 18.0, 24.0, 30.0, 36.0, 42.0, 48.0, 54.0]


def test_hidden_stats_4():
    assert M.quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], n=4, method='inclusive') == [3.25, 5.5, 7.75]


def test_hidden_stats_5():
    assert M.quantiles([2.5, 3.5], n=2) == [3.0]


def test_hidden_stats_6():
    assert round(M.stdev([2, 4, 4, 4, 5, 5, 7, 9]), 9) == 2.138089935


def test_hidden_stats_7():
    assert M.mode([1, 1, 2, 3]) == 1


def test_hidden_stats_8():
    assert M.variance([1, 2, 3, 4]) == 1.6666666666666667
