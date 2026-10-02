import pytest
from kit import lexer as M


def test_hidden_lexer_1():
    assert M.split('a b  c') == ['a', 'b', 'c']


def test_hidden_lexer_2():
    assert M.split('say "hi \\"there\\""') == ['say', 'hi "there"']


def test_hidden_lexer_3():
    assert M.split('"a\\"b"') == ['a"b']


def test_hidden_lexer_4():
    assert M.split("'a\\b'") == ['a\\b']


def test_hidden_lexer_5():
    assert M.split('x "y z" # c', comments=True) == ['x', 'y z']


def test_hidden_lexer_6():
    assert M.quote("it's") == '\'it\'"\'"\'s\''


def test_hidden_lexer_7():
    assert M.join(['a b', 'c']) == "'a b' c"


def test_hidden_lexer_8():
    assert M.split('one\\ two three') == ['one two', 'three']
