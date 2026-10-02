import pytest
from kit import globs as M


def test_hidden_globs_1():
    assert M.fnmatch('a.py', '*.py') == True


def test_hidden_globs_2():
    assert M.fnmatch('b', '[!a]') == True


def test_hidden_globs_3():
    assert M.fnmatch('a', '[!a]') == False


def test_hidden_globs_4():
    assert M.filter(['x1', 'y2', 'x3'], '[!y]?') == ['x1', 'x3']


def test_hidden_globs_5():
    assert M.fnmatchcase('Z', '[!a-z]') == True


def test_hidden_globs_6():
    assert M.fnmatchcase('q', '[!a-z]') == False


def test_hidden_globs_7():
    assert M.fnmatch('dir/f.txt', '*.txt') == True


def test_hidden_globs_8():
    assert M.filter(['a.c', 'b.h', 'c.o'], '*.[ch]') == ['a.c', 'b.h']
