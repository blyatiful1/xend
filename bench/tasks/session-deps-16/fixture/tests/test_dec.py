import pytest
from kit import dec as M


def test_public_dec_1():
    assert str(M.Decimal('1.1') + M.Decimal('2.2')) == '3.3'


def test_public_dec_2():
    assert str(M.Decimal('2.5').quantize(M.Decimal('1'))) == '2'
