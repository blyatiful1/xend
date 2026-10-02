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


def test_hidden_config_1():
    assert _cfg(M, basic=True).get('app', 'name') == 'demo'


def test_hidden_config_2():
    assert _cfg(M).get('paths', 'logs') == '/srv/logs'


def test_hidden_config_3():
    assert _cfg(M).get('app', 'data') == '/srv/data'


def test_hidden_config_4():
    assert _cfg(M).get('app', 'Data') == '/srv/data'


def test_hidden_config_5():
    assert sorted(_cfg(M).options('app')) == ['data', 'name']


def test_hidden_config_6():
    assert _cfg(M, basic=True).get('paths', 'logs') == '${Home}/logs'


def test_hidden_config_7():
    assert _cfg2(M).get('s', 'v') == 'x-%'


def test_hidden_config_8():
    assert _cfg2(M).getboolean('s', 'flag') == True
