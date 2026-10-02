import pytest
from kit import netaddr as M


def test_hidden_netaddr_1():
    assert str(M.ip_network('10.0.0.0/30').broadcast_address) == '10.0.0.3'


def test_hidden_netaddr_2():
    assert [str(n) for n in M.summarize_address_range(M.IPv4Address('192.0.2.0'), M.IPv4Address('192.0.2.130'))] == ['192.0.2.0/25', '192.0.2.128/31', '192.0.2.130/32']


def test_hidden_netaddr_3():
    assert [str(n) for n in M.summarize_address_range(M.IPv4Address('10.0.0.1'), M.IPv4Address('10.0.0.6'))] == ['10.0.0.1/32', '10.0.0.2/31', '10.0.0.4/31', '10.0.0.6/32']


def test_hidden_netaddr_4():
    assert [str(n) for n in M.summarize_address_range(M.IPv4Address('10.0.0.0'), M.IPv4Address('10.0.0.255'))] == ['10.0.0.0/24']


def test_hidden_netaddr_5():
    assert [str(n) for n in M.summarize_address_range(M.IPv6Address('2001:db8::'), M.IPv6Address('2001:db8::4'))] == ['2001:db8::/126', '2001:db8::4/128']


def test_hidden_netaddr_6():
    assert [str(n) for n in M.collapse_addresses([M.ip_network('10.0.0.0/25'), M.ip_network('10.0.0.128/25')])] == ['10.0.0.0/24']


def test_hidden_netaddr_7():
    assert M.ip_address('192.168.1.1').is_private == True


def test_hidden_netaddr_8():
    assert [str(s) for s in M.ip_network('10.0.0.0/24').subnets(prefixlen_diff=2)] == ['10.0.0.0/26', '10.0.0.64/26', '10.0.0.128/26', '10.0.0.192/26']
