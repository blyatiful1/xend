from datetime import datetime, timezone

from logpipe.aggregate import count_by, error_rate, latency_percentiles, top_messages
from logpipe.parse import Record


def mk(level="INFO", service="api", message="m", ts=None, latency_ms=None):
    return Record(
        ts=ts or datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
        level=level,
        service=service,
        message=message,
        latency_ms=latency_ms,
    )


def test_count_by_level():
    records = [mk(level="INFO"), mk(level="ERROR"), mk(level="INFO")]
    assert count_by(records, lambda r: r.level) == {"INFO": 2, "ERROR": 1}


def test_latency_percentiles_nearest_rank():
    records = [mk(latency_ms=v) for v in [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]]
    result = latency_percentiles(records, [50, 95, 100])
    assert result[50] == 50
    assert result[95] == 100
    assert result[100] == 100


def test_latency_percentiles_empty_returns_none():
    result = latency_percentiles([], [50, 95])
    assert result == {50: None, 95: None}


def test_latency_percentiles_ignores_records_without_latency():
    records = [mk(latency_ms=10), mk(latency_ms=None), mk(latency_ms=20)]
    result = latency_percentiles(records, [100])
    assert result[100] == 20


def test_error_rate_buckets_and_omits_empty_windows():
    records = [
        mk(level="INFO", ts=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)),
        mk(level="ERROR", ts=datetime(2024, 1, 1, 12, 0, 30, tzinfo=timezone.utc)),
        mk(level="INFO", ts=datetime(2024, 1, 1, 12, 5, 0, tzinfo=timezone.utc)),
    ]
    result = error_rate(records, 60)
    assert len(result) == 2
    window0, rate0 = result[0]
    assert rate0 == 0.5
    window1, rate1 = result[1]
    assert rate1 == 0.0
    assert window0 < window1


def test_top_messages_ties_broken_by_first_seen():
    records = [mk(message="b"), mk(message="a"), mk(message="b"), mk(message="a")]
    result = top_messages(records, 5)
    assert result == [("b", 2), ("a", 2)]


def test_top_messages_fewer_than_n():
    records = [mk(message="x"), mk(message="x"), mk(message="y")]
    result = top_messages(records, 10)
    assert result == [("x", 2), ("y", 1)]
