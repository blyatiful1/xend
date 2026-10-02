import pytest
from kit import ratio as M


def test_hidden_ratio_1():
    assert str(M.Fraction(3, 4) + M.Fraction(1, 4)) == '1'


def test_hidden_ratio_2():
    assert [round(M.Fraction(n, 2)) for n in (1, 3, 5, 7)] == [0, 2, 2, 4]


def test_hidden_ratio_3():
    assert [round(M.Fraction(n, 2)) for n in (-5, -3, -1, 9, 11)] == [-2, -2, 0, 4, 6]


def test_hidden_ratio_4():
    assert round(M.Fraction(7, 3)) == 2


def test_hidden_ratio_5():
    assert str(round(M.Fraction(25, 100), 1)) == '1/5'


def test_hidden_ratio_6():
    assert str(M.Fraction('3.1415926535897932').limit_denominator(1000)) == '355/113'


def test_hidden_ratio_7():
    assert str(M.Fraction(1, 3) * 3) == '1'


def test_hidden_ratio_8():
    assert M.Fraction(5, 2).__floor__() == 2
