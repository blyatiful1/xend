import pytest
from kit import urls as M


def test_public_urls_1():
    assert M.urlparse('http://x.org:8080/p?q=1#f').port == 8080


def test_public_urls_2():
    assert M.urljoin('http://a/b/c/d;p?q', 'g') == 'http://a/b/c/g'
