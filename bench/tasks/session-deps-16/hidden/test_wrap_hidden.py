import pytest
from kit import wrap as M


def test_hidden_wrap_1():
    assert M.wrap('the quick brown fox jumps over', width=10) == ['the quick', 'brown fox', 'jumps over']


def test_hidden_wrap_2():
    assert M.wrap('abcdefghij', width=4) == ['abcd', 'efgh', 'ij']


def test_hidden_wrap_3():
    assert M.wrap('supercalifragilistic', width=6) == ['superc', 'alifra', 'gilist', 'ic']


def test_hidden_wrap_4():
    assert M.fill('aaaa bbbb cccccccccc', width=5) == 'aaaa\nbbbb \nccccc\nccccc'


def test_hidden_wrap_5():
    assert M.wrap('a b c d e f', width=3) == ['a b', 'c d', 'e f']


def test_hidden_wrap_6():
    assert M.shorten('Hello  world! How are you?', width=12) == 'Hello [...]'


def test_hidden_wrap_7():
    assert M.wrap('xxxxxxxxxx yy', width=4, break_long_words=True) == ['xxxx', 'xxxx', 'xx', 'yy']


def test_hidden_wrap_8():
    assert M.dedent('    a\n      b\n') == 'a\n  b\n'
