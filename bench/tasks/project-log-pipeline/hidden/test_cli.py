import json

import pytest

from logpipe.cli import main

SAMPLE = """\
ts=2024-01-01T12:00:00Z level=info service=api message="request ok" latency_ms=10
ts=2024-01-01T12:00:05Z level=error service=api message=boom latency_ms=200
{"ts": "2024-01-01T12:00:10Z", "level": "info", "service": "worker", "message": "request ok", "latency_ms": 15}
ts=2024-01-01T12:01:00Z level=critical service=worker message=fatal latency_ms=500
not a valid line
"""


@pytest.fixture
def log_file(tmp_path):
    path = tmp_path / "sample.log"
    path.write_text(SAMPLE)
    return path


def test_cli_summarize_text(log_file, capsys):
    rc = main(["summarize", str(log_file)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Total: 4" in out
    assert "Skipped: 1" in out


def test_cli_summarize_json(log_file, capsys):
    rc = main(["summarize", str(log_file), "--format", "json"])
    out = capsys.readouterr().out
    assert rc == 0
    data = json.loads(out)
    assert data["total"] == 4
    assert data["skipped"] == 1
    assert data["by_service"] == {"api": 2, "worker": 2}


def test_cli_summarize_csv(log_file, capsys):
    rc = main(["summarize", str(log_file), "--format", "csv"])
    out = capsys.readouterr().out
    assert rc == 0
    lines = out.splitlines()
    assert lines[0] == "key,value"
    assert "total,4" in lines


def test_cli_filter_level(log_file, capsys):
    rc = main(["filter", str(log_file), "--level", "error"])
    out = capsys.readouterr().out
    assert rc == 0
    lines = out.strip().splitlines()
    assert len(lines) == 2
    assert "boom" in lines[0]
    assert "fatal" in lines[1]


def test_cli_filter_format_json(log_file, capsys):
    rc = main(["filter", str(log_file), "--service", "worker", "--format", "json"])
    out = capsys.readouterr().out
    assert rc == 0
    data = json.loads(out)
    assert len(data) == 2
    assert all(r["service"] == "worker" for r in data)


def test_cli_filter_regex(log_file, capsys):
    rc = main(["filter", str(log_file), "--regex", "^boom$"])
    out = capsys.readouterr().out
    assert rc == 0
    lines = out.strip().splitlines()
    assert len(lines) == 1
    assert "boom" in lines[0]


def test_cli_top(log_file, capsys):
    rc = main(["top", str(log_file), "-n", "1"])
    out = capsys.readouterr().out
    assert rc == 0
    assert out.strip() == "2 request ok"


def test_cli_alerts_success(log_file, tmp_path, capsys):
    rules_path = tmp_path / "rules.json"
    rules_path.write_text(json.dumps([
        {"name": "err", "metric": "error_rate", "threshold": 0.1, "window_seconds": 60},
    ]))
    rc = main(["alerts", str(log_file), "--rules", str(rules_path)])
    out = capsys.readouterr().out
    assert rc == 0
    assert "err" in out


def test_cli_alerts_bad_rules_error(log_file, tmp_path, capsys):
    rules_path = tmp_path / "rules.json"
    rules_path.write_text(json.dumps([{"name": "bad"}]))
    rc = main(["alerts", str(log_file), "--rules", str(rules_path)])
    err = capsys.readouterr().err
    assert rc == 1
    assert "Error" in err


def test_cli_missing_file_error(capsys):
    rc = main(["summarize", "/no/such/file.log"])
    err = capsys.readouterr().err
    assert rc == 1
    assert "Error" in err


def test_cli_usage_error_exit_2(capsys):
    rc = main([])
    capsys.readouterr()
    assert rc == 2


def test_cli_stdin_input(monkeypatch, capsys):
    import io

    monkeypatch.setattr("sys.stdin", io.StringIO(SAMPLE))
    rc = main(["summarize"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "Total: 4" in out
