import pytest
from kit import cal as M


def test_hidden_cal_1():
    assert M.isleap(2024) == True


def test_hidden_cal_2():
    assert M.monthcalendar(2024, 2)[0] == [0, 0, 0, 1, 2, 3, 4]


def test_hidden_cal_3():
    assert M.monthcalendar(2023, 10) == [[0, 0, 0, 0, 0, 0, 1], [2, 3, 4, 5, 6, 7, 8], [9, 10, 11, 12, 13, 14, 15], [16, 17, 18, 19, 20, 21, 22], [23, 24, 25, 26, 27, 28, 29], [30, 31, 0, 0, 0, 0, 0]]


def test_hidden_cal_4():
    assert M.Calendar(firstweekday=6).monthdayscalendar(2024, 9)[0] == [1, 2, 3, 4, 5, 6, 7]


def test_hidden_cal_5():
    assert M.monthrange(2024, 2) == (3, 29)


def test_hidden_cal_6():
    assert list(M.Calendar().itermonthdays(2025, 6))[:8] == [0, 0, 0, 0, 0, 0, 1, 2]


def test_hidden_cal_7():
    assert M.leapdays(1900, 2001) == 25


def test_hidden_cal_8():
    assert M.weekday(2026, 10, 2) == 4
