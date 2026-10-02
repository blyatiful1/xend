import pytest
from kit import diffs as M


def test_public_diffs_1():
    assert round(M.SequenceMatcher(None, 'abcd', 'bcde').ratio(), 6) == 0.75


def test_public_diffs_2():
    assert list(M.unified_diff(['a\n','b\n','c\n'], ['a\n','x\n','c\n'], lineterm='')) == ['--- ', '+++ ', '@@ -1,3 +1,3 @@', ' a\n', '-b\n', '+x\n', ' c\n']
