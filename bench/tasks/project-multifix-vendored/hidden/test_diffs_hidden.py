import pytest
from kit import diffs as M


def test_hidden_diffs_1():
    assert round(M.SequenceMatcher(None, 'abcd', 'bcde').ratio(), 6) == 0.75


def test_hidden_diffs_2():
    assert list(M.unified_diff(['a\n','b\n','c\n'], ['a\n','x\n','c\n'], lineterm='')) == ['--- ', '+++ ', '@@ -1,3 +1,3 @@', ' a\n', '-b\n', '+x\n', ' c\n']


def test_hidden_diffs_3():
    assert list(M.unified_diff(['1\n','2\n','3\n','4\n','5\n'], ['1\n','2\n','three\n','4\n','5\n'], n=1, lineterm='')) == ['--- ', '+++ ', '@@ -2,3 +2,3 @@', ' 2\n', '-3\n', '+three\n', ' 4\n']


def test_hidden_diffs_4():
    assert list(M.unified_diff(['a\n'], ['b\n'], lineterm='')) == ['--- ', '+++ ', '@@ -1 +1 @@', '-a\n', '+b\n']


def test_hidden_diffs_5():
    assert list(M.unified_diff([], ['new\n'], lineterm='')) == ['--- ', '+++ ', '@@ -0,0 +1 @@', '+new\n']


def test_hidden_diffs_6():
    assert list(M.context_diff(['a\n','b\n'], ['a\n','c\n'], lineterm='')) == ['*** ', '--- ', '***************', '*** 1,2 ****', '  a\n', '! b\n', '--- 1,2 ----', '  a\n', '! c\n']


def test_hidden_diffs_7():
    assert M.get_close_matches('appel', ['ape', 'apple', 'peach', 'puppy']) == ['apple', 'ape']


def test_hidden_diffs_8():
    assert list(M.ndiff(['one\n'], ['ore\n'])) == ['- one\n', '?  ^\n', '+ ore\n', '?  ^\n']
