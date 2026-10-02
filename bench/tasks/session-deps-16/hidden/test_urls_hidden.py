import pytest
from kit import urls as M


def test_hidden_urls_1():
    assert M.urlparse('http://x.org:8080/p?q=1#f').port == 8080


def test_hidden_urls_2():
    assert M.urljoin('http://a/b/c/d;p?q', 'g') == 'http://a/b/c/g'


def test_hidden_urls_3():
    assert M.urljoin('http://a/b/c/d;p?q', '../g') == 'http://a/b/g'


def test_hidden_urls_4():
    assert M.urljoin('http://a/b/c/', 'g') == 'http://a/b/c/g'


def test_hidden_urls_5():
    assert M.urljoin('http://a/b/c/d', '?y') == 'http://a/b/c/d?y'


def test_hidden_urls_6():
    assert M.urljoin('http://a/b/c/d', '/g') == 'http://a/g'


def test_hidden_urls_7():
    assert M.urljoin('http://a/b', 'c/./d/../e') == 'http://a/c/e'


def test_hidden_urls_8():
    assert M.parse_qs('a=1&a=2&b=3') == {'a': ['1', '2'], 'b': ['3']}


def test_hidden_urls_9():
    assert M.quote('a b/c') == 'a%20b/c'


def test_hidden_urls_10():
    assert M.urlencode({'x': 'y z'}) == 'x=y+z'
