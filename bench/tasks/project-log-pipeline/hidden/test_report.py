import json

from logpipe.report import render_csv, render_json, render_text


def make_summary(latency=True):
    return {
        "total": 10,
        "skipped": 2,
        "by_level": {"ERROR": 3, "INFO": 7},
        "by_service": {"api": 6, "worker": 4},
        "latency_p50": 12.3 if latency else None,
        "latency_p95": 45.6 if latency else None,
        "latency_p99": 45.6 if latency else None,
    }


def test_render_text_format():
    text = render_text(make_summary())
    lines = text.splitlines()
    assert lines[0] == "Total: 10"
    assert lines[1] == "Skipped: 2"
    assert "  ERROR: 3" in lines
    assert "  INFO: 7" in lines
    assert "  api: 6" in lines
    assert "  worker: 4" in lines
    assert "Latency p50: 12.30" in lines
    assert text.endswith("\n")


def test_render_text_na_for_missing_latency():
    text = render_text(make_summary(latency=False))
    assert "Latency p50: n/a" in text.splitlines()


def test_render_json_roundtrip():
    summary = make_summary()
    text = render_json(summary)
    assert text.endswith("\n")
    assert json.loads(text) == summary


def test_render_csv_basic():
    rows = [("a", 1), ("b", 2.5)]
    text = render_csv(rows)
    lines = text.splitlines()
    assert lines[0] == "key,value"
    assert lines[1] == "a,1"
    assert lines[2] == "b,2.50"
    assert text.endswith("\n")


def test_render_csv_none_value():
    rows = [("p95", None)]
    text = render_csv(rows)
    assert "p95,n/a" in text.splitlines()
