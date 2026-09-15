from datetime import datetime, timezone

import pytest

from logpipe.filters import all_of, any_of, by_level, by_regex, by_service, by_time
from logpipe.parse import Record


def make_record(level="INFO", service="api", message="hello", ts=None, fields=None):
    return Record(
        ts=ts or datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc),
        level=level,
        service=service,
        message=message,
        fields=fields or {},
    )


def test_by_level_orders_severity():
    pred = by_level("warning")
    assert pred(make_record(level="WARNING")) is True
    assert pred(make_record(level="ERROR")) is True
    assert pred(make_record(level="INFO")) is False


def test_by_level_unknown_raises():
    with pytest.raises(ValueError):
        by_level("bogus")


def test_by_level_record_with_unknown_level_never_matches():
    pred = by_level("debug")
    assert pred(make_record(level="TRACE")) is False


def test_by_service():
    pred = by_service(["api", "worker"])
    assert pred(make_record(service="api")) is True
    assert pred(make_record(service="db")) is False


def test_by_time_bounds():
    start = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    end = datetime(2024, 1, 1, 13, 0, 0, tzinfo=timezone.utc)
    pred = by_time(start=start, end=end)
    assert pred(make_record(ts=datetime(2024, 1, 1, 12, 30, 0, tzinfo=timezone.utc))) is True
    assert pred(make_record(ts=datetime(2024, 1, 1, 11, 59, 0, tzinfo=timezone.utc))) is False
    assert pred(make_record(ts=datetime(2024, 1, 1, 13, 0, 1, tzinfo=timezone.utc))) is False


def test_by_regex_field_message():
    pred = by_regex(r"^boo\w+$")
    assert pred(make_record(message="boom")) is True
    assert pred(make_record(message="fizz")) is False


def test_by_regex_field_custom_fields_key():
    pred = by_regex(r"\d+", field="user")
    assert pred(make_record(fields={"user": "42"})) is True
    assert pred(make_record(fields={"user": "nope"})) is False


def test_by_regex_bad_pattern_raises():
    import re

    with pytest.raises(re.error):
        by_regex("(unclosed")


def test_all_of_empty_is_true():
    assert all_of()(make_record()) is True


def test_any_of_empty_is_false():
    assert any_of()(make_record()) is False


def test_all_of_and_any_of_combination():
    pred = all_of(by_service(["api"]), any_of(by_level("error"), by_regex("hi")))
    assert pred(make_record(service="api", level="ERROR", message="x")) is True
    assert pred(make_record(service="api", level="INFO", message="hi there")) is True
    assert pred(make_record(service="api", level="INFO", message="nope")) is False
    assert pred(make_record(service="db", level="ERROR", message="x")) is False
