# logpipe — specification

`logpipe` is a log processing pipeline: parse structured log lines (two
formats), filter, aggregate, evaluate alert rules, render reports, and a
CLI. Implement exactly these six modules under the `logpipe` package:

- `logpipe/parse.py`
- `logpipe/filters.py`
- `logpipe/aggregate.py`
- `logpipe/alerts.py`
- `logpipe/report.py`
- `logpipe/cli.py`

All timestamps are timezone-aware `datetime.datetime` objects in UTC.
Wherever a number must be formatted for text/CSV display, use
`f"{x:.2f}"`. Standard library only.

## `logpipe/parse.py`

```python
@dataclass
class Record:
    ts: datetime            # timezone-aware, UTC
    level: str               # upper-cased, e.g. "INFO", "ERROR"
    service: str
    message: str
    fields: dict = ...        # extra fields beyond ts/level/service/message/latency_ms
    latency_ms: float = None  # optional

class Stats:
    def __init__(self):
        self.parsed = 0
        self.skipped = 0

def parse_line(line) -> Record | None: ...
def parse_stream(iterable, stats=None): ...   # generator of Record
```

Two supported line formats, auto-detected: a line whose stripped text
starts with `"{"` is parsed as a single **JSON object**; every other
non-blank line is parsed as **logfmt** (`key=value` pairs separated by
whitespace, where a value may be a `"..."`-quoted string containing spaces
— quotes are stripped and `\"`/`\\` are unescaped; an unquoted value runs
until the next whitespace).

Required keys (both formats): `ts`, `level`, `service`, `message`.
Optional: `latency_ms` (numeric; must parse as `float` if present — a
non-numeric `latency_ms` makes the whole line unparseable). Every other
key present in the line becomes an entry in `Record.fields` (for logfmt,
values are always `str`; for JSON, values keep their decoded JSON type).

- `ts` is parsed with `datetime.fromisoformat` (so `Z`/`+00:00` offsets and
  bare `YYYY-MM-DDTHH:MM:SS` are both accepted, per Python 3.11's parser).
  A naive result (no offset given) is treated as already being UTC
  (`.replace(tzinfo=timezone.utc)`); an aware result is converted to UTC
  with `.astimezone(timezone.utc)`. If `ts` fails to parse, the line is
  unparseable.
- `level` is upper-cased (`"info"` -> `"INFO"`); any string is accepted at
  parse time (an unrecognized level is only rejected by `filters.by_level`,
  never by `parse_line`).
- `parse_line(line)` returns `None` for: a blank/whitespace-only line; a
  logfmt line with no recognizable `key=value` pairs; a JSON line that
  isn't a JSON object, or is missing a required key; a line (either
  format) missing a required key, with an unparseable `ts`, or an
  unparseable `latency_ms`.
- `parse_stream(iterable, stats=None)` is a generator yielding one `Record`
  per parseable line of `iterable` (each item a line of text, e.g. from an
  open file or a list of strings). If `stats` is given, `stats.parsed` is
  incremented for every yielded `Record` and `stats.skipped` for every
  non-blank line that failed to parse (blank lines affect neither
  counter). Counts are only final once the generator is fully consumed.

## `logpipe/filters.py`

Every function below returns a predicate: a callable `Record -> bool`.

```python
def by_level(min_level): ...
def by_service(names): ...
def by_time(start=None, end=None): ...
def by_regex(pattern, field="message"): ...
def all_of(*preds): ...
def any_of(*preds): ...
```

- `by_level(min_level)`: severity order is
  `DEBUG < INFO < WARNING < ERROR < CRITICAL`. `min_level` is upper-cased
  and looked up; `ValueError(f"unknown level: {min_level!r}")` if it isn't
  one of those five. The returned predicate is `True` when the record's
  (also upper-cased) `level` has severity `>=` `min_level`'s; a record
  whose `level` is not one of the five known levels never matches.
- `by_service(names)`: `True` when `record.service in set(names)`.
- `by_time(start=None, end=None)`: `True` when `(start is None or
  record.ts >= start) and (end is None or record.ts <= end)` (inclusive
  bounds; either side may be omitted).
- `by_regex(pattern, field="message")`: compiles `pattern` with
  `re.compile` (a bad pattern raises `re.error`, propagated unchanged).
  `field` selects the text searched: `"message"`, `"service"`, or
  `"level"` read the matching `Record` attribute directly; any other value
  reads `str(record.fields.get(field, ""))`. `True` when
  `compiled.search(target)` is not `None`.
- `all_of(*preds)` / `any_of(*preds)`: `True` when every / any predicate is
  `True` for the record (`all_of()` with zero predicates is `True`;
  `any_of()` with zero predicates is `False`).

## `logpipe/aggregate.py`

```python
def count_by(records, key): ...
def latency_percentiles(records, pcts): ...
def error_rate(records, window_seconds): ...
def top_messages(records, n): ...
```

- `count_by(records, key)`: `key` is a callable `Record -> Hashable`.
  Returns a `dict` mapping each distinct `key(record)` value to how many
  records had it, keys in first-seen order.
- `latency_percentiles(records, pcts)`: only records with `latency_ms is
  not None` are considered. `pcts` is an iterable of numbers (e.g.
  `[50, 95, 99]`). Uses the **nearest-rank** method: sort the latencies
  ascending (length `n`); for each requested percentile `p`, `rank =
  ceil(p / 100 * n)` clamped to `[1, n]` (1-indexed), value =
  `sorted_latencies[rank - 1]`. Returns a `dict` mapping each value in
  `pcts` (as given) to its float value, or to `None` for every requested
  percentile if there are zero eligible records.
- `error_rate(records, window_seconds)`: buckets records into fixed,
  non-overlapping windows of `window_seconds` seconds anchored at the Unix
  epoch: `window_index = floor(record.ts.timestamp() / window_seconds)`,
  `window_start = datetime.fromtimestamp(window_index * window_seconds,
  tz=timezone.utc)`. Returns a list of `(window_start, rate)` tuples, one
  per **non-empty** window (empty windows are omitted), in ascending
  `window_start` order, where `rate = (# records in the window with level
  "ERROR" or "CRITICAL") / (# records in the window)`.
- `top_messages(records, n)`: the `n` most frequent `record.message`
  values as a list of `(message, count)` tuples, sorted by count
  descending, ties broken by first-seen order ascending. At most `n`
  entries (fewer if there are fewer distinct messages).

## `logpipe/alerts.py`

```python
class RuleError(Exception): ...

@dataclass
class Alert:
    rule_name: str
    metric: str                  # "error_rate" | "p95_latency" | "count"
    service: str | None
    value: float
    threshold: float
    window_start: datetime

def evaluate(records, rules) -> list: ...
```

A rule is a `dict` (as loaded from a JSON file): `{"name": str, "metric":
"error_rate"|"p95_latency"|"count", "service"?: str, "threshold": number,
"window_seconds": positive int}`.

`evaluate(records, rules)` validates and evaluates each rule **in the
order given**:

- Validation, checked in this order, each violation raising
  `RuleError(f"rule {rule_id}: {problem}")` where `rule_id` is the rule's
  own `"name"` if it is a non-empty string, else `f"#{index}"` (`index`
  the rule's 0-based position in `rules`):
  1. `"name"` missing, or not a non-empty string -> `"missing or invalid field 'name'"`.
  2. `"metric"` missing -> `"missing field 'metric'"`; present but not one
     of the three allowed values -> `f"invalid metric {metric!r}"`.
  3. `"threshold"` missing -> `"missing field 'threshold'"`; present but
     not a number (a `bool` does not count as a number here) ->
     `"threshold must be a number"`.
  4. `"window_seconds"` missing -> `"missing field 'window_seconds'"`;
     present but not a positive `int` (a `bool` does not count) ->
     `"window_seconds must be a positive integer"`.
  5. `"service"`, if present and not `None`, must be a `str`, else
     `"service must be a string"`.
- Evaluation: if `"service"` is given, only records with that `service`
  are considered for this rule. The remaining records are bucketed into
  fixed `window_seconds`-second windows using the same epoch-anchored
  scheme as `aggregate.error_rate`. For each **non-empty** window, in
  ascending `window_start` order:
  - `metric == "error_rate"`: `value` = that window's error rate (as
    `aggregate.error_rate` defines it, restricted to this rule's subset).
  - `metric == "count"`: `value` = the number of records in the window
    (as a `float`).
  - `metric == "p95_latency"`: `value` = the 95th percentile latency
    (nearest-rank) of that window's records; if the window has no record
    with a `latency_ms`, it is skipped for this rule (no alert, since the
    metric can't be computed).
  - An `Alert(rule["name"], metric, service, value, float(threshold),
    window_start)` is appended to the result whenever `value > threshold`
    (strict).
- Returns every triggered `Alert`, ordered by rule order first, then
  ascending `window_start` within a rule.

## `logpipe/report.py`

```python
def render_text(summary) -> str: ...
def render_json(summary) -> str: ...
def render_csv(rows) -> str: ...
```

`summary` is a `dict` with keys `total` (int), `skipped` (int),
`by_level` (dict of level -> count), `by_service` (dict of service ->
count), `latency_p50`/`latency_p95`/`latency_p99` (float rounded to 2
decimal places with `round(x, 2)`, or `None`) — this is exactly the shape
the `summarize` CLI command builds (see below).

- `render_text(summary)`: fixed format, trailing newline:
  ```
  Total: {total}
  Skipped: {skipped}
  By level:
    {level}: {count}
  By service:
    {service}: {count}
  Latency p50: {value}
  Latency p95: {value}
  Latency p99: {value}
  ```
  `by_level`/`by_service` rows sorted by key ascending; one `  {key}: {count}`
  line per entry. Each latency value is `f"{x:.2f}"`, or `"n/a"` if `None`.
- `render_json(summary)`: `json.dumps(summary, indent=2, sort_keys=True)`
  plus a trailing newline.
- `render_csv(rows)`: `rows` is an iterable of `(key, value)` pairs, value
  one of `int`, `float`, `str`, or `None`. Header `key,value`, then one
  `{key},{formatted_value}` line per row — `"n/a"` if `None`, `f"{value:.2f}"`
  if a `float`, else `str(value)`. `"\n"` line endings, trailing newline
  after the last row.

## `logpipe/cli.py`

```python
def main(argv) -> int: ...
```

Built with `argparse`. `-h`/`--help` and any usage error are handled by
`argparse` (`sys.exit`); `main` catches the resulting `SystemExit` and
returns its code unchanged (`0` for `--help`, `2` for a genuine usage
error). Any other error (bad input file, bad `--level`, bad regex, bad
alert rule) prints `Error: {message}` to stderr (`{message}` = `str(exception)`)
and returns `1`. Every successful subcommand returns `0`.

Every subcommand accepts zero or more positional `FILE` arguments (read
and concatenated in the order given) — with **zero** files given, input is
read from stdin instead — and `--format text|json|csv` (default `text`).
Input lines are turned into `Record`s with `parse.parse_stream`.

- **`summarize [FILE ...] [--format ...]`** — builds the `summary` dict
  described under `report.py`: `total` = number of parsed records,
  `skipped` = `Stats.skipped` from parsing, `by_level`/`by_service` =
  `aggregate.count_by` keyed by `record.level`/`record.service`,
  `latency_p50`/`p95`/`p99` = `aggregate.latency_percentiles(records, [50,
  95, 99])`, each rounded with `round(x, 2)` (or `None`). Renders with
  `report.render_text`/`render_json` directly. For `--format csv`, the
  rows passed to `report.render_csv` are, in this order: `("total",
  total)`, `("skipped", skipped)`, `("latency_p50", p50)`,
  `("latency_p95", p95)`, `("latency_p99", p99)`, then one
  `(f"level:{level}", count)` per `by_level` entry (sorted by level
  ascending), then one `(f"service:{service}", count)` per `by_service`
  entry (sorted by service ascending).
- **`filter [FILE ...] [--level LEVEL] [--service NAME ...] [--start ISO]
  [--end ISO] [--regex PATTERN] [--regex-field FIELD] [--format ...]`** —
  `--service` is repeatable (OR semantics: matches any given service);
  `--start`/`--end` are ISO 8601 strings parsed the same way as `ts` (see
  `parse.py`; naive means UTC). Every filter option given is combined with
  **AND** semantics (`filters.all_of`) — an option that is not given is
  simply not included. `--regex-field` defaults to `"message"` and is only
  meaningful together with `--regex`. With `--format text` (default), one
  line per matching record: `f"{r.ts.isoformat()} {r.level} {r.service}: {r.message}"`.
  With `--format json`: a JSON array (`json.dumps(..., indent=2)`, trailing
  newline) of objects `{"ts": r.ts.isoformat(), "level":, "service":,
  "message":, "fields":, "latency_ms":}`, one per matching record, in
  input order. With `--format csv`: header
  `ts,level,service,message,latency_ms` (via the `csv` module,
  `lineterminator="\n"`), `latency_ms` formatted `f"{x:.2f}"` or empty if
  `None`.
- **`alerts [FILE ...] --rules RULES_JSON_PATH [--format ...]`** — `--rules`
  is required: a path to a JSON file containing a JSON array of rule
  objects (see `alerts.py`); a missing file or invalid JSON is the shared
  `Error:`/return-`1` handling, likewise a `RuleError` from
  `alerts.evaluate`. With `--format text` (default), one line per
  triggered alert, in `evaluate`'s order:
  `f"{a.window_start.isoformat()} {a.rule_name} {a.metric}: {a.value:.2f} > {a.threshold:.2f}"`,
  with `" (service={a.service})"` appended when `a.service` is not `None`.
  With `--format json`: a JSON array of `{"rule_name":, "metric":,
  "service":, "value": round(value, 2), "threshold": round(threshold, 2),
  "window_start": isoformat str}`. With `--format csv`: header
  `rule_name,metric,service,value,threshold,window_start`, `service`
  empty string if `None`, `value`/`threshold` formatted `f"{x:.2f}"`.
- **`top [FILE ...] [-n N] [--format ...]`** (`-n`/`--top`, default `10`)
  — `rows = aggregate.top_messages(records, n)`. With `--format text`
  (default): one line per row, `f"{count} {message}"`. With `--format
  json`: a JSON array of `{"message":, "count":}` objects. With `--format
  csv`: exactly `report.render_csv(rows)`.

## Notes

- Do not add any third-party dependency; the standard library is
  sufficient (`argparse`, `csv`, `dataclasses`, `datetime`, `json`, `math`,
  `re`).
- `Record.fields` values from a JSON-format line keep their JSON type
  (e.g. an int stays an int); from a logfmt-format line they are always
  plain strings.
