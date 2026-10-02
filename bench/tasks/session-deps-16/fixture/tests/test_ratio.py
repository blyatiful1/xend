import pytest
from kit import ratio as M


def test_public_ratio_1():
    assert str(M.Fraction(3, 4) + M.Fraction(1, 4)) == '1'


def test_public_ratio_2():
    assert [round(M.Fraction(n, 2)) for n in (1, 3, 5, 7)] == [0, 2, 2, 4]
