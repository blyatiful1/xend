import pytest
from kit import cal as M


def test_public_cal_1():
    assert M.isleap(2024) == True


def test_public_cal_2():
    assert M.monthcalendar(2024, 2)[0] == [0, 0, 0, 1, 2, 3, 4]
