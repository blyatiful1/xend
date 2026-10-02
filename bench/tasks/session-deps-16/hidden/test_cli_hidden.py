import pytest
from kit import cli as M

def _p(M):
    p = M.ArgumentParser(prog='t')
    p.add_argument('--level', nargs='?', const='hi', default='lo')
    p.add_argument('pos', nargs='?', const='pc', default='pd')
    p.add_argument('--n', type=int, default=3)
    return p


def test_hidden_cli_1():
    assert vars(_p(M).parse_args(['x', '--n', '5'])) == {'level': 'lo', 'pos': 'x', 'n': 5}


def test_hidden_cli_2():
    assert _p(M).parse_args(['--level']).level == 'hi'


def test_hidden_cli_3():
    assert _p(M).parse_args([]).pos == 'pd'


def test_hidden_cli_4():
    assert _p(M).parse_args(['--level', 'mid']).level == 'mid'


def test_hidden_cli_5():
    assert _p(M).parse_args([]).level == 'lo'


def test_hidden_cli_6():
    assert _p(M).parse_args(['--n', '7']).n == 7


def test_hidden_cli_7():
    assert _p(M).parse_args(['y', '--level']).pos == 'y'


def test_hidden_cli_8():
    assert _p(M).format_usage() == 'usage: t [-h] [--level [LEVEL]] [--n N] [pos]\n'
