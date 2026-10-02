import pytest
from kit import config as M

CFG = '[paths]\nhome = /srv\nlogs = ${Home}/logs\n[app]\nData = ${paths:Home}/data\nname = demo\n'

def _cfg(M, basic=False):
    p = M.ConfigParser(interpolation=None if basic else M.ExtendedInterpolation())
    p.read_string(CFG)
    return p

def _cfg2(M):
    p = M.ConfigParser()
    p.read_string('[s]\nbase = x\nv = %(base)s-%%\nflag = on\n')
    return p


def test_public_config_1():
    assert _cfg(M, basic=True).get('app', 'name') == 'demo'


def test_public_config_2():
    assert _cfg(M).get('paths', 'logs') == '/srv/logs'
