import pytest
from kit import cli as M

def _p(M):
    p = M.ArgumentParser(prog='t')
    p.add_argument('--level', nargs='?', const='hi', default='lo')
    p.add_argument('pos', nargs='?', const='pc', default='pd')
    p.add_argument('--n', type=int, default=3)
    return p


def test_public_cli_1():
    assert vars(_p(M).parse_args(['x', '--n', '5'])) == {'level': 'lo', 'pos': 'x', 'n': 5}


def test_public_cli_2():
    assert _p(M).parse_args(['--level']).level == 'hi'
