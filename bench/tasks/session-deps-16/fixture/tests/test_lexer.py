import pytest
from kit import lexer as M


def test_public_lexer_1():
    assert M.split('a b  c') == ['a', 'b', 'c']


def test_public_lexer_2():
    assert M.split('say "hi \\"there\\""') == ['say', 'hi "there"']
