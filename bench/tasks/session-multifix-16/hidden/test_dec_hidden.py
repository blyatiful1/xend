import pytest
from kit import dec as M


def test_hidden_dec_1():
    assert str(M.Decimal('1.1') + M.Decimal('2.2')) == '3.3'


def test_hidden_dec_2():
    assert str(M.Decimal('2.5').quantize(M.Decimal('1'))) == '2'


def test_hidden_dec_3():
    assert str(M.Decimal('3.5').quantize(M.Decimal('1'))) == '4'


def test_hidden_dec_4():
    assert str(M.Decimal('0.125').quantize(M.Decimal('0.01'))) == '0.12'


def test_hidden_dec_5():
    assert str(M.Decimal('-2.5').quantize(M.Decimal('1'))) == '-2'


def test_hidden_dec_6():
    assert str(round(M.Decimal('4.5'))) == '4'


def test_hidden_dec_7():
    assert str(M.Decimal('2.675').quantize(M.Decimal('0.01'), rounding=M.ROUND_HALF_UP)) == '2.68'


def test_hidden_dec_8():
    assert str(M.Decimal(1) / M.Decimal(7)) == '0.1428571428571428571428571429'


def test_hidden_dec_9():
    assert str(M.Decimal('7.45').quantize(M.Decimal('0.1'))) == '7.4'
