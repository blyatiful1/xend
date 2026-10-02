import pytest
from kit import plist as M

import datetime


def test_hidden_plist_1():
    assert M.loads(M.dumps({'a': 1, 'b': [True, 'x']})) == {'a': 1, 'b': [True, 'x']}


def test_hidden_plist_2():
    assert M.loads(M.dumps({'d': datetime.datetime(2024, 3, 7, 1, 2, 3)}))['d'] == datetime.datetime(2024, 3, 7, 1, 2, 3)


def test_hidden_plist_3():
    assert M.loads(M.dumps({'d': datetime.datetime(1999, 12, 31, 23, 59, 58)}))['d'] == datetime.datetime(1999, 12, 31, 23, 59, 58)


def test_hidden_plist_4():
    assert M.loads(M.dumps({'d': datetime.datetime(2024, 1, 2)}))['d'] == datetime.datetime(2024, 1, 2, 0, 0)


def test_hidden_plist_5():
    assert M.loads(M.dumps({'d': datetime.datetime(2024, 11, 5, 6)}), fmt=M.FMT_XML)['d'] == datetime.datetime(2024, 11, 5, 6, 0)


def test_hidden_plist_6():
    assert M.loads(M.dumps({'d': datetime.datetime(2024, 5, 20, 8, 9, 10)}, fmt=M.FMT_BINARY))['d'] == datetime.datetime(2024, 5, 20, 8, 9, 10)


def test_hidden_plist_7():
    assert M.loads(M.dumps({'n': 3, 's': 'x'})) == {'n': 3, 's': 'x'}


def test_hidden_plist_8():
    assert M.loads(M.dumps([1.5, b'raw'])) == [1.5, b'raw']
