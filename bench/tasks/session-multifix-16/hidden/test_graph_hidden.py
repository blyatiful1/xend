import pytest
from kit import graph as M

def _batches(M, g):
    ts = M.TopologicalSorter(g)
    ts.prepare()
    out = []
    while ts.is_active():
        ready = sorted(ts.get_ready())
        if not ready:
            break
        out.append(ready)
        ts.done(*ready)
    return out

def _valid(M, g):
    order = list(M.TopologicalSorter(g).static_order())
    nodes = set(g) | set().union(*g.values())
    pos = {n: i for i, n in enumerate(order)}
    return sorted(order) == sorted(nodes) and all(pos[p] < pos[n] for n in g for p in g[n])

def _cycle(M, g):
    try:
        list(M.TopologicalSorter(g).static_order())
    except M.CycleError:
        return 'cycle'
    return 'no cycle'


def test_hidden_graph_1():
    assert list(M.TopologicalSorter({}).static_order()) == []


def test_hidden_graph_2():
    assert list(M.TopologicalSorter({'b': {'a'}}).static_order()) == ['a', 'b']


def test_hidden_graph_3():
    assert list(M.TopologicalSorter({'c': {'b'}, 'b': {'a'}}).static_order()) == ['a', 'b', 'c']


def test_hidden_graph_4():
    assert _batches(M, {'d': {'b', 'c'}, 'b': {'a'}, 'c': {'a'}}) == [['a'], ['b', 'c'], ['d']]


def test_hidden_graph_5():
    assert _batches(M, {'b': {'a'}, 'c': {'a'}, 'e': {'d'}}) == [['a', 'd'], ['b', 'c', 'e']]


def test_hidden_graph_6():
    assert _valid(M, {'d': {'b', 'c'}, 'b': {'a'}, 'c': {'a'}, 'e': {'d', 'a'}}) == True


def test_hidden_graph_7():
    assert _cycle(M, {'a': {'b'}, 'b': {'a'}}) == 'cycle'


def test_hidden_graph_8():
    assert _batches(M, {'x': set()}) == [['x']]
