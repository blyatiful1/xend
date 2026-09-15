from datetime import datetime, timezone

from logpipe.parse import Stats, parse_line, parse_stream


def test_parse_logfmt_basic():
    r = parse_line('ts=2024-01-01T12:00:00Z level=info service=api message=hello latency_ms=10')
    assert r is not None
    assert r.ts == datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    assert r.level == "INFO"
    assert r.service == "api"
    assert r.message == "hello"
    assert r.latency_ms == 10.0


def test_parse_logfmt_quoted_message_with_spaces():
    r = parse_line('ts=2024-01-01T12:00:00Z level=info service=api message="hello world"')
    assert r is not None
    assert r.message == "hello world"
    assert r.latency_ms is None


def test_parse_json_basic():
    line = '{"ts": "2024-01-01T12:00:05Z", "level": "error", "service": "worker", "message": "boom", "latency_ms": 99}'
    r = parse_line(line)
    assert r is not None
    assert r.level == "ERROR"
    assert r.service == "worker"
    assert r.message == "boom"
    assert r.latency_ms == 99.0


def test_parse_returns_none_for_blank_line():
    assert parse_line("") is None
    assert parse_line("   \n") is None


def test_parse_returns_none_for_garbage_line():
    assert parse_line("this is not a log line") is None


def test_parse_logfmt_missing_required_field_returns_none():
    assert parse_line('ts=2024-01-01T12:00:00Z level=info message=hello') is None


def test_parse_json_missing_required_field_returns_none():
    line = '{"ts": "2024-01-01T12:00:00Z", "level": "info", "message": "hello"}'
    assert parse_line(line) is None


def test_parse_invalid_latency_returns_none():
    r = parse_line('ts=2024-01-01T12:00:00Z level=info service=api message=hi latency_ms=notanumber')
    assert r is None


def test_parse_naive_timestamp_assumed_utc():
    r = parse_line('ts=2024-01-01T12:00:00 level=info service=api message=hi')
    assert r is not None
    assert r.ts == datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


def test_parse_stream_counts_parsed_and_skipped():
    lines = [
        'ts=2024-01-01T12:00:00Z level=info service=api message=ok',
        'garbage line',
        '',
        'ts=2024-01-01T12:00:01Z level=info service=api message=ok2',
    ]
    stats = Stats()
    records = list(parse_stream(lines, stats=stats))
    assert len(records) == 2
    assert stats.parsed == 2
    assert stats.skipped == 1


def test_parse_fields_extra_keys_logfmt_are_strings():
    r = parse_line('ts=2024-01-01T12:00:00Z level=info service=api message=hi user=42')
    assert r.fields == {"user": "42"}


def test_parse_fields_extra_keys_json_keep_type():
    line = '{"ts": "2024-01-01T12:00:00Z", "level": "info", "service": "api", "message": "hi", "user": 42}'
    r = parse_line(line)
    assert r.fields == {"user": 42}
    assert isinstance(r.fields["user"], int)
