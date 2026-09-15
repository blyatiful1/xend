#!/usr/bin/env bash
set -eu
mkdir -p logpipe

cat > logpipe/__init__.py <<'PYEOF'
"""logpipe: a log processing pipeline (parse, filter, aggregate, alert, report, CLI)."""
PYEOF

cat > logpipe/parse.py <<'PYEOF'
"""Parsing of structured log lines (logfmt or single-line JSON) into Records."""

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional

_KV_RE = re.compile(r'(\w+)=("(?:[^"\\]|\\.)*"|\S*)')
_REQUIRED = ("ts", "level", "service", "message")
_RESERVED = ("ts", "level", "service", "message", "latency_ms")


@dataclass
class Record:
    ts: datetime
    level: str
    service: str
    message: str
    fields: Dict[str, object] = field(default_factory=dict)
    latency_ms: Optional[float] = None


class Stats:
    """Running counters updated as parse_stream consumes its input."""

    def __init__(self):
        self.parsed = 0
        self.skipped = 0


def _to_utc(dt):
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_ts(value):
    try:
        return _to_utc(datetime.fromisoformat(str(value)))
    except (ValueError, TypeError):
        return None


def _unquote(value):
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        inner = value[1:-1]
        return inner.replace('\\"', '"').replace("\\\\", "\\")
    return value


def _parse_logfmt(line):
    pairs = _KV_RE.findall(line)
    if not pairs:
        return None
    kv = {key: _unquote(value) for key, value in pairs}
    if not all(k in kv for k in _REQUIRED):
        return None
    ts = _parse_ts(kv["ts"])
    if ts is None:
        return None
    latency_ms = None
    if "latency_ms" in kv:
        try:
            latency_ms = float(kv["latency_ms"])
        except ValueError:
            return None
    fields = {k: v for k, v in kv.items() if k not in _RESERVED}
    return Record(
        ts=ts,
        level=kv["level"].upper(),
        service=kv["service"],
        message=kv["message"],
        fields=fields,
        latency_ms=latency_ms,
    )


def _parse_json(line):
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict) or not all(k in obj for k in _REQUIRED):
        return None
    ts = _parse_ts(obj["ts"])
    if ts is None:
        return None
    latency_ms = None
    if "latency_ms" in obj:
        try:
            latency_ms = float(obj["latency_ms"])
        except (TypeError, ValueError):
            return None
    fields = {k: v for k, v in obj.items() if k not in _RESERVED}
    return Record(
        ts=ts,
        level=str(obj["level"]).upper(),
        service=str(obj["service"]),
        message=str(obj["message"]),
        fields=fields,
        latency_ms=latency_ms,
    )


def parse_line(line):
    """Parse one log line as JSON (if it starts with '{') or logfmt, else None.

    Required fields: ts (ISO 8601, any offset - normalized to UTC; naive
    timestamps are assumed to already be UTC), level, service, message.
    latency_ms is optional and must be numeric if present. Any other field
    ends up in Record.fields. Returns None for a blank line or any line
    that fails to parse.
    """
    stripped = line.strip()
    if not stripped:
        return None
    if stripped.startswith("{"):
        return _parse_json(stripped)
    return _parse_logfmt(stripped)


def parse_stream(iterable, stats=None):
    """Yield a Record for each parseable line in `iterable`.

    If `stats` (a Stats instance) is given, stats.parsed and stats.skipped
    are incremented as lines are consumed (blank lines are not counted
    either way). This is a generator: counts are only complete once the
    caller has fully consumed it.
    """
    for line in iterable:
        if not line.strip():
            continue
        record = parse_line(line)
        if record is None:
            if stats is not None:
                stats.skipped += 1
            continue
        if stats is not None:
            stats.parsed += 1
        yield record
PYEOF

cat > logpipe/filters.py <<'PYEOF'
"""Composable predicates over Record objects."""

import re

LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")


def by_level(min_level):
    """Return a predicate matching records whose level is >= `min_level` in
    severity, using the order DEBUG < INFO < WARNING < ERROR < CRITICAL.

    Raises ValueError(f"unknown level: {min_level!r}") if `min_level`
    (case-insensitively) is not one of LEVELS. A record whose own `level`
    is not one of LEVELS never matches (the predicate returns False).
    """
    normalized = str(min_level).upper()
    if normalized not in LEVELS:
        raise ValueError(f"unknown level: {min_level!r}")
    min_index = LEVELS.index(normalized)

    def predicate(record):
        if record.level not in LEVELS:
            return False
        return LEVELS.index(record.level) >= min_index

    return predicate


def by_service(names):
    """Return a predicate matching records whose `service` is in `names`."""
    name_set = set(names)

    def predicate(record):
        return record.service in name_set

    return predicate


def by_time(start=None, end=None):
    """Return a predicate matching records with start <= ts <= end
    (either bound may be None to leave that side unbounded)."""

    def predicate(record):
        if start is not None and record.ts < start:
            return False
        if end is not None and record.ts > end:
            return False
        return True

    return predicate


def by_regex(pattern, field="message"):
    """Return a predicate matching records whose `field` (one of
    "message", "service", "level", or a key into `record.fields`, coerced
    to str) contains a match for `pattern` (via re.search)."""
    compiled = re.compile(pattern)

    def predicate(record):
        if field == "message":
            target = record.message
        elif field == "service":
            target = record.service
        elif field == "level":
            target = record.level
        else:
            target = str(record.fields.get(field, ""))
        return compiled.search(target) is not None

    return predicate


def all_of(*preds):
    """Return a predicate that is True only when every one of `preds` is
    True for the record (True for zero predicates)."""

    def predicate(record):
        return all(p(record) for p in preds)

    return predicate


def any_of(*preds):
    """Return a predicate that is True when any one of `preds` is True for
    the record (False for zero predicates)."""

    def predicate(record):
        return any(p(record) for p in preds)

    return predicate
PYEOF

cat > logpipe/aggregate.py <<'PYEOF'
"""Aggregation helpers: counting, percentiles, error rate windows, top-N."""

import math
from datetime import datetime, timezone

_ERROR_LEVELS = ("ERROR", "CRITICAL")


def count_by(records, key):
    """Return a dict mapping key(record) -> count, one entry per distinct
    value, in first-seen order. `key` is a callable Record -> Hashable."""
    counts = {}
    for record in records:
        k = key(record)
        counts[k] = counts.get(k, 0) + 1
    return counts


def latency_percentiles(records, pcts):
    """Return a dict mapping each value in `pcts` to the corresponding
    latency percentile (nearest-rank method) over every record with a
    non-None `latency_ms`, or None for every requested percentile if there
    are no such records.

    Nearest rank: latencies sorted ascending; for percentile p,
    rank = ceil(p / 100 * n) clamped to [1, n] (1-indexed); the value is
    sorted_latencies[rank - 1].
    """
    latencies = sorted(r.latency_ms for r in records if r.latency_ms is not None)
    n = len(latencies)
    result = {}
    for p in pcts:
        if n == 0:
            result[p] = None
            continue
        rank = math.ceil((p / 100) * n)
        rank = max(1, min(n, rank))
        result[p] = latencies[rank - 1]
    return result


def _window_start(ts, window_seconds):
    epoch_seconds = ts.timestamp()
    index = math.floor(epoch_seconds / window_seconds)
    return datetime.fromtimestamp(index * window_seconds, tz=timezone.utc)


def error_rate(records, window_seconds):
    """Bucket `records` into fixed, non-overlapping windows of
    `window_seconds` seconds anchored at the Unix epoch. Return a list of
    (window_start, rate) tuples, one per non-empty window in ascending
    window_start order, where rate is
    (# ERROR/CRITICAL records in the window) / (# records in the window).
    Windows with no records are omitted.
    """
    buckets = {}
    for record in records:
        w = _window_start(record.ts, window_seconds)
        total, errors = buckets.get(w, (0, 0))
        total += 1
        if record.level in _ERROR_LEVELS:
            errors += 1
        buckets[w] = (total, errors)
    return [(w, buckets[w][1] / buckets[w][0]) for w in sorted(buckets)]


def top_messages(records, n):
    """Return the `n` most frequent record.message values as a list of
    (message, count) tuples, sorted by count descending, ties broken by
    first-seen order ascending. At most `n` entries."""
    counts = {}
    order = []
    for record in records:
        if record.message not in counts:
            counts[record.message] = 0
            order.append(record.message)
        counts[record.message] += 1
    ranked = sorted(order, key=lambda m: -counts[m])  # stable: preserves first-seen order on ties
    return [(m, counts[m]) for m in ranked[:n]]
PYEOF

cat > logpipe/alerts.py <<'PYEOF'
"""Alert rule evaluation over a batch of Records."""

from dataclasses import dataclass
from datetime import datetime
from numbers import Number
from typing import Optional

from .aggregate import _window_start, error_rate, latency_percentiles
from .filters import by_service

_METRICS = ("error_rate", "p95_latency", "count")


class RuleError(Exception):
    """Raised when an alert rule dict is invalid."""


@dataclass
class Alert:
    rule_name: str
    metric: str
    service: Optional[str]
    value: float
    threshold: float
    window_start: datetime


def _rule_id(rule, index):
    name = rule.get("name")
    return name if isinstance(name, str) and name else f"#{index}"


def _validate_rule(rule, index):
    rid = _rule_id(rule, index)
    if "name" not in rule or not isinstance(rule["name"], str) or not rule["name"]:
        raise RuleError(f"rule {rid}: missing or invalid field 'name'")
    if "metric" not in rule:
        raise RuleError(f"rule {rid}: missing field 'metric'")
    if rule["metric"] not in _METRICS:
        raise RuleError(f"rule {rid}: invalid metric {rule['metric']!r}")
    if "threshold" not in rule:
        raise RuleError(f"rule {rid}: missing field 'threshold'")
    if isinstance(rule["threshold"], bool) or not isinstance(rule["threshold"], Number):
        raise RuleError(f"rule {rid}: threshold must be a number")
    if "window_seconds" not in rule:
        raise RuleError(f"rule {rid}: missing field 'window_seconds'")
    ws = rule["window_seconds"]
    if isinstance(ws, bool) or not isinstance(ws, int) or ws <= 0:
        raise RuleError(f"rule {rid}: window_seconds must be a positive integer")
    if "service" in rule and rule["service"] is not None and not isinstance(rule["service"], str):
        raise RuleError(f"rule {rid}: service must be a string")


def evaluate(records, rules):
    """Evaluate every rule against `records`, in rule order, and return the
    list of triggered Alerts (rule order, then ascending window_start
    within a rule). A rule dict must have "name" (non-empty str), "metric"
    (one of "error_rate", "p95_latency", "count"), "threshold" (a number),
    "window_seconds" (a positive int), and optionally "service" (a str) to
    restrict the rule to one service. Raises RuleError naming the rule on
    any invalid rule.
    """
    records = list(records)
    alerts = []
    for index, rule in enumerate(rules):
        _validate_rule(rule, index)
        service = rule.get("service")
        subset = [r for r in records if service is None or by_service([service])(r)]
        metric = rule["metric"]
        threshold = float(rule["threshold"])
        window_seconds = rule["window_seconds"]

        if metric == "error_rate":
            for window_start, rate in error_rate(subset, window_seconds):
                if rate > threshold:
                    alerts.append(
                        Alert(rule["name"], metric, service, rate, threshold, window_start)
                    )
        elif metric == "count":
            buckets = {}
            for r in subset:
                w = _window_start(r.ts, window_seconds)
                buckets[w] = buckets.get(w, 0) + 1
            for window_start in sorted(buckets):
                count = buckets[window_start]
                if count > threshold:
                    alerts.append(
                        Alert(rule["name"], metric, service, float(count), threshold, window_start)
                    )
        elif metric == "p95_latency":
            buckets = {}
            for r in subset:
                w = _window_start(r.ts, window_seconds)
                buckets.setdefault(w, []).append(r)
            for window_start in sorted(buckets):
                p95 = latency_percentiles(buckets[window_start], [95])[95]
                if p95 is not None and p95 > threshold:
                    alerts.append(
                        Alert(rule["name"], metric, service, p95, threshold, window_start)
                    )
    return alerts
PYEOF

cat > logpipe/report.py <<'PYEOF'
"""Rendering a summary dict, or (key, value) rows, as text/JSON/CSV."""

import json


def _fmt_value(value):
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def render_text(summary):
    """Render a summary dict (see the `summarize` CLI command) as fixed-
    format text, ending in a trailing newline:

        Total: {total}
        Skipped: {skipped}
        By level:
          {level}: {count}
        By service:
          {service}: {count}
        Latency p50: {value or "n/a"}
        Latency p95: {value or "n/a"}
        Latency p99: {value or "n/a"}

    `by_level`/`by_service` rows are sorted by key ascending.
    """
    lines = [f"Total: {summary['total']}", f"Skipped: {summary['skipped']}", "By level:"]
    for level in sorted(summary["by_level"]):
        lines.append(f"  {level}: {summary['by_level'][level]}")
    lines.append("By service:")
    for service in sorted(summary["by_service"]):
        lines.append(f"  {service}: {summary['by_service'][service]}")
    lines.append(f"Latency p50: {_fmt_value(summary['latency_p50'])}")
    lines.append(f"Latency p95: {_fmt_value(summary['latency_p95'])}")
    lines.append(f"Latency p99: {_fmt_value(summary['latency_p99'])}")
    return "\n".join(lines) + "\n"


def render_json(summary):
    """Render `summary` as indented, key-sorted JSON, ending in a trailing
    newline."""
    return json.dumps(summary, indent=2, sort_keys=True) + "\n"


def render_csv(rows):
    """Render `rows` (an iterable of (key, value) pairs, value one of int,
    float, str, or None) as CSV text: header "key,value", then one
    "key,value" line per row (value "n/a" if None, formatted f"{v:.2f}" if
    a float, else str(value)), "\\n" line endings, trailing newline after
    the last row."""
    lines = ["key,value"]
    for key, value in rows:
        lines.append(f"{key},{_fmt_value(value)}")
    return "\n".join(lines) + "\n"
PYEOF

cat > logpipe/cli.py <<'PYEOF'
"""Command-line interface for logpipe."""

import argparse
import csv
import io
import json
import re
import sys
from datetime import datetime, timezone

from . import aggregate, filters, report
from .alerts import RuleError, evaluate
from .parse import Stats, parse_stream


def _to_utc(dt):
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_dt(value):
    return _to_utc(datetime.fromisoformat(value))


def _record_to_dict(r):
    return {
        "ts": r.ts.isoformat(),
        "level": r.level,
        "service": r.service,
        "message": r.message,
        "fields": r.fields,
        "latency_ms": r.latency_ms,
    }


def _alert_to_dict(a):
    return {
        "rule_name": a.rule_name,
        "metric": a.metric,
        "service": a.service,
        "value": round(a.value, 2),
        "threshold": round(a.threshold, 2),
        "window_start": a.window_start.isoformat(),
    }


def _read_records(files):
    stats = Stats()
    if files:
        lines = []
        for path in files:
            with open(path, "r", encoding="utf-8") as f:
                lines.extend(f.readlines())
    else:
        lines = sys.stdin
    records = list(parse_stream(lines, stats=stats))
    return records, stats


def _build_parser():
    parser = argparse.ArgumentParser(prog="logpipe")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("summarize")
    p.add_argument("files", nargs="*")
    p.add_argument("--format", choices=["text", "json", "csv"], default="text")

    p = sub.add_parser("filter")
    p.add_argument("files", nargs="*")
    p.add_argument("--format", choices=["text", "json", "csv"], default="text")
    p.add_argument("--level", default=None)
    p.add_argument("--service", action="append", default=[])
    p.add_argument("--start", default=None)
    p.add_argument("--end", default=None)
    p.add_argument("--regex", default=None)
    p.add_argument("--regex-field", dest="regex_field", default="message")

    p = sub.add_parser("alerts")
    p.add_argument("files", nargs="*")
    p.add_argument("--format", choices=["text", "json", "csv"], default="text")
    p.add_argument("--rules", required=True)

    p = sub.add_parser("top")
    p.add_argument("files", nargs="*")
    p.add_argument("--format", choices=["text", "json", "csv"], default="text")
    p.add_argument("-n", "--top", dest="n", type=int, default=10)

    return parser


def main(argv):
    """Run the logpipe CLI. Returns the process exit code: 0 on success,
    1 on an input error, 2 on a usage error."""
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 2

    try:
        if args.command == "summarize":
            records, stats = _read_records(args.files)
            by_level = aggregate.count_by(records, lambda r: r.level)
            by_service = aggregate.count_by(records, lambda r: r.service)
            pcts = aggregate.latency_percentiles(records, [50, 95, 99])
            summary = {
                "total": len(records),
                "skipped": stats.skipped,
                "by_level": by_level,
                "by_service": by_service,
                "latency_p50": round(pcts[50], 2) if pcts[50] is not None else None,
                "latency_p95": round(pcts[95], 2) if pcts[95] is not None else None,
                "latency_p99": round(pcts[99], 2) if pcts[99] is not None else None,
            }
            if args.format == "json":
                sys.stdout.write(report.render_json(summary))
            elif args.format == "csv":
                rows = [
                    ("total", summary["total"]),
                    ("skipped", summary["skipped"]),
                    ("latency_p50", summary["latency_p50"]),
                    ("latency_p95", summary["latency_p95"]),
                    ("latency_p99", summary["latency_p99"]),
                ]
                rows += [(f"level:{lvl}", cnt) for lvl, cnt in sorted(by_level.items())]
                rows += [(f"service:{svc}", cnt) for svc, cnt in sorted(by_service.items())]
                sys.stdout.write(report.render_csv(rows))
            else:
                sys.stdout.write(report.render_text(summary))
            return 0

        if args.command == "filter":
            records, _stats = _read_records(args.files)
            preds = []
            if args.level:
                preds.append(filters.by_level(args.level))
            if args.service:
                preds.append(filters.by_service(args.service))
            if args.start or args.end:
                start = _parse_dt(args.start) if args.start else None
                end = _parse_dt(args.end) if args.end else None
                preds.append(filters.by_time(start, end))
            if args.regex:
                preds.append(filters.by_regex(args.regex, field=args.regex_field))
            predicate = filters.all_of(*preds)
            matched = [r for r in records if predicate(r)]

            if args.format == "json":
                sys.stdout.write(json.dumps([_record_to_dict(r) for r in matched], indent=2) + "\n")
            elif args.format == "csv":
                buf = io.StringIO()
                writer = csv.writer(buf, lineterminator="\n")
                writer.writerow(["ts", "level", "service", "message", "latency_ms"])
                for r in matched:
                    latency = f"{r.latency_ms:.2f}" if r.latency_ms is not None else ""
                    writer.writerow([r.ts.isoformat(), r.level, r.service, r.message, latency])
                sys.stdout.write(buf.getvalue())
            else:
                for r in matched:
                    print(f"{r.ts.isoformat()} {r.level} {r.service}: {r.message}")
            return 0

        if args.command == "alerts":
            records, _stats = _read_records(args.files)
            with open(args.rules, "r", encoding="utf-8") as f:
                rules = json.load(f)
            triggered = evaluate(records, rules)

            if args.format == "json":
                sys.stdout.write(json.dumps([_alert_to_dict(a) for a in triggered], indent=2) + "\n")
            elif args.format == "csv":
                buf = io.StringIO()
                writer = csv.writer(buf, lineterminator="\n")
                writer.writerow(["rule_name", "metric", "service", "value", "threshold", "window_start"])
                for a in triggered:
                    writer.writerow(
                        [a.rule_name, a.metric, a.service or "", f"{a.value:.2f}",
                         f"{a.threshold:.2f}", a.window_start.isoformat()]
                    )
                sys.stdout.write(buf.getvalue())
            else:
                for a in triggered:
                    suffix = f" (service={a.service})" if a.service else ""
                    print(
                        f"{a.window_start.isoformat()} {a.rule_name} {a.metric}: "
                        f"{a.value:.2f} > {a.threshold:.2f}{suffix}"
                    )
            return 0

        if args.command == "top":
            records, _stats = _read_records(args.files)
            rows = aggregate.top_messages(records, args.n)

            if args.format == "json":
                sys.stdout.write(
                    json.dumps([{"message": m, "count": c} for m, c in rows], indent=2) + "\n"
                )
            elif args.format == "csv":
                sys.stdout.write(report.render_csv(rows))
            else:
                for message, count in rows:
                    print(f"{count} {message}")
            return 0

    except (RuleError, OSError, ValueError, re.error) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    parser.error(f"unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
PYEOF

