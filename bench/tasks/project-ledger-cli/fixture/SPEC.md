# ledger — specification

`ledger` is a double-entry bookkeeping library with JSONL file persistence and
a command-line interface. Implement exactly these six modules under the
`ledger` package:

- `ledger/model.py`
- `ledger/store.py`
- `ledger/journal.py`
- `ledger/report.py`
- `ledger/importer.py`
- `ledger/cli.py`

All monetary amounts are `decimal.Decimal`. Dates are ISO 8601 `"YYYY-MM-DD"`
strings (no time-of-day, no timezone). Wherever an amount must be quantized
to a fixed number of decimals, use
`amount.quantize(Decimal("0.01"), rounding=decimal.ROUND_HALF_EVEN)`.

## `ledger/model.py`

Constants:

```python
ACCOUNT_KINDS = ("asset", "liability", "equity", "income", "expense")
ENTRY_SIDES = ("debit", "credit")
```

Exceptions (all importable from `ledger.model`):

```python
class LedgerError(Exception): ...          # base class for every error this package raises
class ValidationError(LedgerError): ...    # a value or combination of values is invalid
class NotFoundError(LedgerError): ...      # a referenced account/transaction does not exist
class DuplicateError(LedgerError): ...     # creating something whose identifier already exists
```

### `Account` (dataclass)

Fields, in order: `name: str`, `kind: str`, `currency: str = "USD"`.

Validated in `__post_init__`, raising `ValidationError`:
- `name` must be a non-empty `str`, else `ValidationError(f"invalid account name: {name!r}")`.
- `kind` must be one of `ACCOUNT_KINDS`, else `ValidationError(f"invalid account kind: {kind!r}")`.
- `currency` must be a non-empty `str`, else `ValidationError(f"invalid currency: {currency!r}")`.

### `Entry` (dataclass)

Fields, in order: `account: str` (an account name), `amount: Decimal`, `side: str`.

Validated in `__post_init__`, raising `ValidationError`:
- `side` must be one of `ENTRY_SIDES`, else `ValidationError(f"invalid entry side: {side!r}")`.
- `amount` must be a `Decimal` instance, else `ValidationError(f"entry amount must be a Decimal: {amount!r}")`.
- `amount` must be `> 0`, else `ValidationError(f"entry amount must be positive: {amount}")`.

### `Transaction` (dataclass)

Fields, in order: `id: str`, `date: str`, `description: str`, `entries: List[Entry]` (default empty list).

Validated in `__post_init__`, raising `ValidationError`, checked in this order:
1. `date` must match `^\d{4}-\d{2}-\d{2}$`, else `ValidationError(f"invalid date: {date!r}")`.
2. `len(entries) >= 2`, else `ValidationError(f"transaction {id} must have at least two entries")`.
3. `sum(amount of debit-side entries) == sum(amount of credit-side entries)` (exact `Decimal`
   equality), else `ValidationError(f"transaction {id} is not balanced: debits {debit_total} != credits {credit_total}")`
   where `debit_total`/`credit_total` are the summed `Decimal` totals.

`Transaction` does **not** check that referenced accounts exist or share a currency — that is
`Journal.post`'s job.

## `ledger/store.py`

```python
class StoreError(LedgerError): ...   # importable from ledger.store; subclasses ledger.model.LedgerError
```

JSONL schema — the ledger file holds one JSON object per line:
- Account record: `{"type": "account", "name": ..., "kind": ..., "currency": ...}`
- Transaction record: `{"type": "transaction", "id": ..., "date": ..., "description": ...,
  "entries": [{"account": ..., "amount": "12.34", "side": "debit"}, ...]}`

`Decimal` amounts are always serialized as JSON **strings** (`str(amount)`), never as JSON numbers.
Blank/whitespace-only lines are ignored, not errors.

```python
class Store:
    def __init__(self, path): ...    # path: str or os.PathLike; store as self.path (a pathlib.Path)
    def load(self): ...              # -> (accounts: list[Account], transactions: list[Transaction])
    def append(self, record): ...    # record: an Account or a Transaction instance
```

- `load()` returns `([], [])` if `self.path` does not exist. Accounts and transactions are returned
  as two separate lists, each in file order. A line number is the file's 1-indexed physical line.
  - Invalid JSON on a line -> `StoreError` whose message starts with `f"corrupt line {n}: "`.
  - Valid JSON but not an object, or an object missing `"type"` -> `StoreError(f"corrupt line {n}: missing 'type' field")`.
  - `"type"` present but not `"account"`/`"transaction"` -> `StoreError(f"corrupt line {n}: unknown record type {type!r}")`.
  - A record missing a required field, or one whose fields fail `Account`/`Entry`/`Transaction`
    validation -> `StoreError` whose message starts with `f"corrupt line {n}: "`.
- `append(record)` performs an atomic rewrite: read every existing record, serialize existing
  records plus the new one, write the result to a temporary file in the same directory, then
  replace the target path with `os.replace` (so an interrupted write can never leave a
  half-written ledger file). Passing anything other than an `Account` or `Transaction` raises
  `TypeError`.

## `ledger/journal.py`

```python
class Journal:
    def __init__(self): ...
    def open_account(self, name, kind, currency="USD") -> Account: ...
    def get_account(self, name) -> Account: ...
    def accounts(self) -> list: ...          # Account objects, sorted by name ascending
    def transactions(self) -> list: ...      # Transaction objects, in post order
    def post(self, date, description, entries, tx_id=None) -> Transaction: ...
    def balance(self, account_name, as_of=None) -> Decimal: ...
    def close_period(self, as_of, income_summary="Income Summary",
                      retained_earnings="Retained Earnings") -> Transaction: ...
    @classmethod
    def load(cls, store) -> "Journal": ...
```

- `open_account`: raises `DuplicateError(f"account already exists: {name}")` if `name` is already
  registered (checked *before* constructing the `Account`). Otherwise constructs and stores an
  `Account`, returns it (`Account`'s own `ValidationError` propagates unchanged).
- `get_account`: raises `NotFoundError(f"account not found: {name}")` if not registered; else
  returns the `Account`.
- `accounts()`: all registered accounts, sorted by `.name`.
- `transactions()`: a new list of every posted transaction, in the order `post` was called for it
  (or file order, after `load`).
- `post(date, description, entries, tx_id=None)`: `entries` is a list of `(account_name, amount,
  side)` 3-tuples (`amount` a `Decimal`). Steps, in this exact order:
  1. If `tx_id is not None` and a transaction with that id already exists, raise
     `DuplicateError(f"transaction id already exists: {tx_id}")`.
  2. For every `(account_name, amount, side)`, look up the account with `get_account` (its
     `NotFoundError` propagates unchanged for an unregistered account).
  3. If the referenced accounts' `currency` values are not all identical, raise
     `ValidationError(f"currency mismatch in transaction: {sorted(set_of_currencies)}")`.
  4. Compute the id: `tx_id` if given, else the next auto id `f"T{n:04d}"` where
     `n = 1 + max(existing numeric suffixes of ids matching ^T\d+$, default=0)` (so ids stay
     monotonically increasing even across a reload, and are never reused).
  5. Build `Entry` objects (their `ValidationError` propagates unchanged) and a
     `Transaction(id=new_id, date=date, description=description, entries=entry_objs)` (its
     `ValidationError` propagates unchanged: at least two entries, balanced, valid date).
  6. Append the transaction to the journal and return it.
- `balance(account_name, as_of=None)`: raises `NotFoundError` via `get_account` if unknown. Sums
  every entry ever posted to that account across transactions with `date <= as_of` (all
  transactions if `as_of is None`; plain string comparison, which is correct for `YYYY-MM-DD`
  dates). For accounts of kind `"asset"` or `"expense"` (normal-debit): `balance = debit_total -
  credit_total`. For `"liability"`, `"equity"`, `"income"` (normal-credit): `balance = credit_total
  - debit_total`. The result is quantized to 2 decimal places with `ROUND_HALF_EVEN`.
- `close_period(as_of, income_summary="Income Summary", retained_earnings="Retained Earnings")`:
  both account names must already be registered (`NotFoundError` via `get_account`, checked first).
  For every registered account of kind `"income"` or `"expense"` whose `balance(name,
  as_of=as_of)` is non-zero, add two entries that zero it out: if the balance is positive, debit
  the account and credit `income_summary` (for an `"income"` account) or credit the account and
  debit `income_summary` (for an `"expense"` account); if the balance is negative, the two sides
  are swapped. The amount posted for that pair is always `abs(balance)`. Let `net = sum(income
  balances) - sum(expense balances)` (the signed, non-absolute balances). If `net > 0`, add a
  final debit to `income_summary` and credit to `retained_earnings` of `net`. If `net < 0`, add a
  final credit to `income_summary` and debit to `retained_earnings` of `abs(net)`. If `net == 0`,
  no final pair is added. If no income/expense account had a non-zero balance, raise
  `ValidationError("nothing to close")` without posting anything. Otherwise post all the
  accumulated entries as **one** transaction via `self.post(as_of, f"Close period as of {as_of}",
  entries)` (auto-generated id) and return it.
- `Journal.load(store)`: calls `store.load()`, registers every account (raising
  `DuplicateError(f"account already exists: {name}")` if the same name appears twice), then
  appends every transaction in file order (raising `DuplicateError(f"transaction id already
  exists: {id}")` if the same id appears twice). Does not re-validate that transactions' accounts
  exist or balance (already validated when originally written).

## `ledger/report.py`

```python
def trial_balance(journal, as_of=None) -> list: ...   # list of (name, debit: Decimal, credit: Decimal)
def statement(journal, account_name, start=None, end=None) -> list: ...
    # list of (date, tx_id, description, debit: Decimal, credit: Decimal, balance: Decimal)
def to_csv(rows) -> str: ...   # rows shaped like trial_balance()'s
```

- `trial_balance`: one `(account_name, debit, credit)` row per account **currently registered**
  (an account with zero postings still appears, with `debit=credit=Decimal("0.00")`), sorted by
  `account_name` ascending. Unlike `Journal.balance`, this uses the **raw** debit/credit totals
  posted to the account, not the normal-balance sign convention: `net = debit_total -
  credit_total`; `debit = net` (quantized to 2dp) if `net > 0` else `Decimal("0.00")`; `credit =
  -net` (quantized) if `net < 0` else `Decimal("0.00")`. Consequently `sum(debit over all rows) ==
  sum(credit over all rows)` always holds. `as_of` filters to transactions dated `<= as_of`.
- `statement`: raises `NotFoundError` (via `journal.get_account`) if `account_name` is
  unregistered. One `(date, tx_id, description, debit, credit, balance)` row per entry ever
  posted to that account whose transaction's `date` is `>= start` (if given) and `<= end` (if
  given), sorted by `(date, tx_id)` ascending. `debit`/`credit` are that entry's amount in its own
  column and `Decimal("0.00")` in the other (both quantized to 2dp). `balance` is the account's
  running normal-balance-signed balance (same sign convention as `Journal.balance`) after applying
  that entry, starting from `Decimal("0.00")` and re-quantized to 2dp after every row.
- `to_csv(rows)`: header line `account,debit,credit`, then one line per row `name,debit,credit`
  with each amount formatted `f"{amount:.2f}"`, using `"\n"` line endings (not `"\r\n"`), returned
  as a single string (ending in a trailing newline after the last row).

## `ledger/importer.py`

```python
def import_csv(journal, path) -> tuple: ...   # (imported: list[Transaction], errors: list[(int, str)])
```

Reads the CSV file at `path`. Its first line must be the exact header
`date,description,account,amount,side` (5 columns, that literal order and spelling); otherwise
raise `ValidationError(f"invalid CSV header: expected {expected_list}, got {actual_list}")` (or
`ValidationError("empty CSV file: missing header")` if the file has no lines) before importing
anything.

Grouping: the header is physical line 1, so the first data row is line 2. Reading data rows in
file order, consecutive rows that share the same `(date, description)` pair combine into one
candidate transaction; a row whose `(date, description)` differs from the previous row starts a
new group.

For each group, in order:
- Parse every row: split into its 5 columns. A row with a column count other than 5, an `amount`
  that `Decimal(...)` cannot parse, or a `side` that is not exactly `"debit"` or `"credit"` is a
  **row error**: append `(line_no, message)` to the returned `errors` list (`line_no` is that
  row's own physical line number; `message` is any short description) — but keep checking every
  other row in the group before moving on, so one group can contribute several row errors. If the
  group had any row error, skip posting it entirely (do not call `journal.post` for it).
- If the group had no row errors, compute its duplicate key: `(date, description,
  total_debit_amount)` where `total_debit_amount` is the sum of the amounts of its `"debit"`-side
  rows. If a transaction already in `journal.transactions()` (computed the same way from its own
  entries) — or a transaction already imported earlier in this same `import_csv` call — has an
  identical key, silently skip the group (no post, no error recorded).
- Otherwise call `journal.post(date, description, entries)` (auto-generated id) with `entries`
  being the group's parsed `(account, amount, side)` tuples in row order. If this raises
  `NotFoundError` or `ValidationError`, append `(line_no, str(exception))` to `errors` using the
  group's **last** row's physical line number, and do not post anything for that group. Otherwise
  append the returned `Transaction` to `imported`, in posting order.

Returns `(imported, errors)`.

## `ledger/cli.py`

```python
def main(argv) -> int: ...
```

Built with `argparse`. Every invocation is `main(["--file", PATH, SUBCOMMAND, ...])` — `--file`
is a required global option (path to the JSONL ledger file) that appears before the subcommand
name. `-h`/`--help`, and any usage error (missing required argument, unknown subcommand, unknown
flag), are handled by `argparse` itself, which calls `sys.exit`; `main` catches that `SystemExit`
and returns its code unchanged (`0` for `--help`, `2` for a genuine usage error). Every other
error prints `Error: {message}` to stderr (`{message}` is `str(exception)`) and returns `1`.
Every successful subcommand returns `0` except `import` when it recorded any row/group errors
(see below).

Subcommands (all also take the global `--file PATH`):

- **`init`** — no extra arguments. If the file at `PATH` already exists, print `Error: ledger
  already exists: {PATH}` to stderr and return `1`. Otherwise create an empty file at `PATH` and
  print `Initialized ledger at {PATH}` to stdout; return `0`.
- **`add-account NAME KIND [--currency CUR]`** (`--currency` defaults to `"USD"`) — loads the
  journal, calls `journal.open_account(NAME, KIND, CUR)`, persists it with `store.append`, prints
  `Created account {name} ({kind}, {currency})`, returns `0`. On `ValidationError`/`DuplicateError`
  use the shared error handling (return `1`).
- **`post --date DATE --description DESC --entry ACCOUNT:AMOUNT:SIDE [--entry ...] [--id TXID]`**
  — `--entry` is repeatable and each value splits on `:` into exactly 3 parts (account names must
  not contain `:`); a value that doesn't split into exactly 3 parts, or whose `AMOUNT` is not a
  valid `Decimal`, raises `Error: invalid --entry value: {value!r}` (return `1`) before the journal
  is touched. Otherwise calls `journal.post(DATE, DESC, entries, tx_id=TXID or None)`, persists the
  transaction, prints `Posted {tx.id}`, returns `0`.
- **`balance ACCOUNT [--as-of DATE]`** — prints `{ACCOUNT}: {balance}` (the `Decimal`'s natural
  `str()`, e.g. `Cash: 60.00` or `Cash: -5.00`); returns `0`.
- **`trial-balance [--as-of DATE] [--format text|csv]`** (default `text`) — with `--format csv`,
  writes exactly `report.to_csv(rows)` to stdout. With `--format text` (default), prints one line
  per row `f"{name}: debit {debit:.2f} credit {credit:.2f}"`, then a final line
  `f"TOTAL: debit {total_debit:.2f} credit {total_credit:.2f}"` (the column sums). Returns `0`.
- **`statement ACCOUNT [--start DATE] [--end DATE] [--format text|csv]`** (default `text`) — with
  `--format csv`, writes a CSV with header `date,tx_id,description,debit,credit,balance`, one row
  per `statement()` row (amounts `f"{x:.2f}"`, `"\n"` line endings). With `--format text`
  (default), first prints `Statement for {ACCOUNT}`, then one line per row:
  `f"{date} {tx_id} {description}: debit {debit:.2f} credit {credit:.2f} balance {balance:.2f}"`.
  Returns `0`; unknown account -> shared error handling, return `1`.
- **`import CSV_PATH`** — calls `importer.import_csv`, persists every imported transaction, prints
  `Imported {n} transaction(s)` to stdout (`n = len(imported)`). If there were any errors,
  additionally prints one `line {line_no}: {message}` per error and a final `{count} error(s)`
  line, all to **stderr**, and returns `1` (even if some transactions imported); with zero errors,
  returns `0`.
- **`export [--out PATH2]`** — one CSV row per entry of every posted transaction (in transaction
  post order, then entry order), as `(date, description, account, amount, side)`, header
  `date,description,account,amount,side`, amounts `f"{amount:.2f}"`, `"\n"` line endings. Without
  `--out`, writes the CSV text to stdout and returns `0`. With `--out PATH2`, writes it to that
  file instead and prints `Exported {n} entries to {PATH2}` to stdout (`n` = number of data rows
  written), returns `0`.

## Notes

- Do not add any third-party dependency; the standard library is sufficient (`argparse`, `csv`,
  `dataclasses`, `decimal`, `json`, `pathlib`, `re`).
- Account names never contain a `:` (so `post --entry ACCOUNT:AMOUNT:SIDE` can be split on `:`
  unambiguously).
