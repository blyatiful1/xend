"""Public example tests: a small subset of the hidden suite's happy paths.

These are here so you can sanity-check your implementation as you build it.
The hidden grading suite covers every requirement in SPEC.md in much more
depth (including every error path) — do not treat this file as complete.
"""

from datetime import datetime, timezone

from logpipe.aggregate import count_by
from logpipe.cli import main
from logpipe.filters import by_level
from logpipe.parse import Record, parse_line
from logpipe.report import render_csv


def test_parse_logfmt_basic():
    r = parse_line('ts=2024-01-01T12:00:00Z level=info service=api message=hello latency_ms=10')
    assert r is not None
    assert r.ts == datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    assert r.level == "INFO"
    assert r.service == "api"
    assert r.message == "hello"
    assert r.latency_ms == 10.0


def test_count_by_level():
    records = [
        Record(ts=datetime.now(timezone.utc), level="INFO", service="api", message="m"),
        Record(ts=datetime.now(timezone.utc), level="ERROR", service="api", message="m"),
        Record(ts=datetime.now(timezone.utc), level="INFO", service="api", message="m"),
    ]
    assert count_by(records, lambda r: r.level) == {"INFO": 2, "ERROR": 1}


def test_by_level_orders_severity():
    def mk(level):
        return Record(ts=datetime.now(timezone.utc), level=level, service="api", message="m")

    pred = by_level("warning")
    assert pred(mk("WARNING")) is True
    assert pred(mk("ERROR")) is True
    assert pred(mk("INFO")) is False


def test_render_csv_basic():
    rows = [("a", 1), ("b", 2.5)]
    text = render_csv(rows)
    lines = text.splitlines()
    assert lines[0] == "key,value"
    assert lines[1] == "a,1"
    assert lines[2] == "b,2.50"
    assert text.endswith("\n")


def test_cli_summarize_text(tmp_path, capsys):
    log_file = tmp_path / "sample.log"
    log_file.write_text(
        'ts=2024-01-01T12:00:00Z level=info service=api message="request ok" latency_ms=10\n'
        'ts=2024-01-01T12:00:05Z level=error service=api message=boom latency_ms=200\n'
    )
    rc = main(["summarize", str(log_file)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Total: 2" in out
