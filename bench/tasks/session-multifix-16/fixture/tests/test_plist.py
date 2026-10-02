import pytest
from kit import plist as M

import datetime


def test_public_plist_1():
    assert M.loads(M.dumps({'a': 1, 'b': [True, 'x']})) == {'a': 1, 'b': [True, 'x']}


def test_public_plist_2():
    assert M.loads(M.dumps({'d': datetime.datetime(2024, 3, 7, 1, 2, 3)}))['d'] == datetime.datetime(2024, 3, 7, 1, 2, 3)
