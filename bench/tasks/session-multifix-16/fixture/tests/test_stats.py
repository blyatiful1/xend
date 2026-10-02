import pytest
from kit import stats as M


def test_public_stats_1():
    assert M.median([1, 3, 5, 7]) == 4.0


def test_public_stats_2():
    assert M.quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], n=4) == [2.75, 5.5, 8.25]
