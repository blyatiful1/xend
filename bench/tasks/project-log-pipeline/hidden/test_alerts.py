from datetime import datetime, timezone

import pytest

from logpipe.alerts import RuleError, evaluate
from logpipe.parse import Record


def mk(level="INFO", service="api", ts=None, latency_ms=None):
    return Record(
        ts=ts or datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
        level=level,
        service=service,
        message="m",
        latency_ms=latency_ms,
    )


def test_evaluate_error_rate_triggers():
    records = [
        mk(level="ERROR", ts=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)),
        mk(level="INFO", ts=datetime(2024, 1, 1, 12, 0, 10, tzinfo=timezone.utc)),
    ]
    rules = [{"name": "r1", "metric": "error_rate", "threshold": 0.3, "window_seconds": 60}]
    alerts = evaluate(records, rules)
    assert len(alerts) == 1
    assert alerts[0].rule_name == "r1"
    assert alerts[0].value == 0.5


def test_evaluate_count_metric():
    records = [mk(ts=datetime(2024, 1, 1, 12, 0, i, tzinfo=timezone.utc)) for i in range(5)]
    rules = [{"name": "r1", "metric": "count", "threshold": 3, "window_seconds": 60}]
    alerts = evaluate(records, rules)
    assert len(alerts) == 1
    assert alerts[0].value == 5.0


def test_evaluate_p95_latency_metric():
    records = [mk(latency_ms=v, ts=datetime(2024, 1, 1, 12, 0, i, tzinfo=timezone.utc))
               for i, v in enumerate([10, 20, 30, 200])]
    rules = [{"name": "r1", "metric": "p95_latency", "threshold": 100, "window_seconds": 60}]
    alerts = evaluate(records, rules)
    assert len(alerts) == 1
    assert alerts[0].value == 200


def test_evaluate_service_filter_restricts_records():
    records = [
        mk(service="api", level="ERROR", ts=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)),
        mk(service="worker", level="ERROR", ts=datetime(2024, 1, 1, 12, 0, 1, tzinfo=timezone.utc)),
        mk(service="worker", level="ERROR", ts=datetime(2024, 1, 1, 12, 0, 2, tzinfo=timezone.utc)),
    ]
    rules = [{"name": "r1", "metric": "count", "service": "worker", "threshold": 1, "window_seconds": 60}]
    alerts = evaluate(records, rules)
    assert len(alerts) == 1
    assert alerts[0].value == 2.0
    assert alerts[0].service == "worker"


def test_evaluate_no_trigger_when_below_threshold():
    records = [mk(ts=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc))]
    rules = [{"name": "r1", "metric": "count", "threshold": 10, "window_seconds": 60}]
    assert evaluate(records, rules) == []


def test_evaluate_multiple_rules_preserve_rule_order():
    records = [
        mk(level="ERROR", ts=datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)),
        mk(level="ERROR", ts=datetime(2024, 1, 1, 12, 0, 1, tzinfo=timezone.utc)),
    ]
    rules = [
        {"name": "second", "metric": "count", "threshold": 1, "window_seconds": 60},
        {"name": "first", "metric": "error_rate", "threshold": 0.1, "window_seconds": 60},
    ]
    alerts = evaluate(records, rules)
    assert [a.rule_name for a in alerts] == ["second", "first"]


def test_rule_error_missing_name():
    with pytest.raises(RuleError):
        evaluate([], [{"metric": "count", "threshold": 1, "window_seconds": 60}])


def test_rule_error_invalid_metric():
    with pytest.raises(RuleError):
        evaluate([], [{"name": "r", "metric": "bogus", "threshold": 1, "window_seconds": 60}])


def test_rule_error_bad_threshold():
    with pytest.raises(RuleError):
        evaluate([], [{"name": "r", "metric": "count", "threshold": "high", "window_seconds": 60}])


def test_rule_error_bad_window_seconds():
    with pytest.raises(RuleError):
        evaluate([], [{"name": "r", "metric": "count", "threshold": 1, "window_seconds": 0}])


def test_rule_error_names_the_rule():
    try:
        evaluate([], [{"name": "my-rule", "metric": "bogus", "threshold": 1, "window_seconds": 60}])
        assert False, "expected RuleError"
    except RuleError as exc:
        assert "my-rule" in str(exc)
