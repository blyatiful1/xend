import pytest
from kit import netaddr as M


def test_public_netaddr_1():
    assert str(M.ip_network('10.0.0.0/30').broadcast_address) == '10.0.0.3'


def test_public_netaddr_2():
    assert [str(n) for n in M.summarize_address_range(M.IPv4Address('192.0.2.0'), M.IPv4Address('192.0.2.130'))] == ['192.0.2.0/25', '192.0.2.128/31', '192.0.2.130/32']
