import pytest
from kit import globs as M


def test_public_globs_1():
    assert M.fnmatch('a.py', '*.py') == True


def test_public_globs_2():
    assert M.fnmatch('b', '[!a]') == True
