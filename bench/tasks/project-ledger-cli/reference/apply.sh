#!/usr/bin/env bash
set -eu
mkdir -p ledger

cat > ledger/__init__.py <<'PYEOF'
"""ledger: a double-entry bookkeeping ledger with JSONL persistence and a CLI."""
PYEOF

cat > ledger/model.py <<'PYEOF'
"""Core domain model for the ledger: accounts, entries, transactions, errors."""

import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import List

ACCOUNT_KINDS = ("asset", "liability", "equity", "income", "expense")
ENTRY_SIDES = ("debit", "credit")

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class LedgerError(Exception):
    """Base class for all ledger errors."""


class ValidationError(LedgerError):
    """Raised when an account, entry, or transaction fails validation."""


class NotFoundError(LedgerError):
    """Raised when a referenced account or transaction does not exist."""


class DuplicateError(LedgerError):
    """Raised when creating an account or transaction whose identifier already exists."""


@dataclass
class Account:
    name: str
    kind: str
    currency: str = "USD"

    def __post_init__(self):
        if not isinstance(self.name, str) or not self.name:
            raise ValidationError(f"invalid account name: {self.name!r}")
        if self.kind not in ACCOUNT_KINDS:
            raise ValidationError(f"invalid account kind: {self.kind!r}")
        if not isinstance(self.currency, str) or not self.currency:
            raise ValidationError(f"invalid currency: {self.currency!r}")


@dataclass
class Entry:
    account: str
    amount: Decimal
    side: str

    def __post_init__(self):
        if self.side not in ENTRY_SIDES:
            raise ValidationError(f"invalid entry side: {self.side!r}")
        if not isinstance(self.amount, Decimal):
            raise ValidationError(f"entry amount must be a Decimal: {self.amount!r}")
        if self.amount <= 0:
            raise ValidationError(f"entry amount must be positive: {self.amount}")


@dataclass
class Transaction:
    id: str
    date: str
    description: str
    entries: List[Entry] = field(default_factory=list)

    def __post_init__(self):
        if not isinstance(self.date, str) or not _DATE_RE.match(self.date):
            raise ValidationError(f"invalid date: {self.date!r}")
        if len(self.entries) < 2:
            raise ValidationError(
                f"transaction {self.id} must have at least two entries"
            )
        debit_total = sum(
            (e.amount for e in self.entries if e.side == "debit"), Decimal("0")
        )
        credit_total = sum(
            (e.amount for e in self.entries if e.side == "credit"), Decimal("0")
        )
        if debit_total != credit_total:
            raise ValidationError(
                f"transaction {self.id} is not balanced: "
                f"debits {debit_total} != credits {credit_total}"
            )
PYEOF

cat > ledger/store.py <<'PYEOF'
"""JSONL persistence for accounts and transactions."""

import json
import os
from decimal import Decimal
from pathlib import Path

from .model import Account, DuplicateError, Entry, LedgerError, Transaction, ValidationError


class StoreError(LedgerError):
    """Raised when the JSONL ledger file contains a corrupt or unrecognized line."""


def _account_to_dict(account):
    return {
        "type": "account",
        "name": account.name,
        "kind": account.kind,
        "currency": account.currency,
    }


def _entry_to_dict(entry):
    return {
        "account": entry.account,
        "amount": str(entry.amount),
        "side": entry.side,
    }


def _transaction_to_dict(tx):
    return {
        "type": "transaction",
        "id": tx.id,
        "date": tx.date,
        "description": tx.description,
        "entries": [_entry_to_dict(e) for e in tx.entries],
    }


def _record_to_dict(record):
    if isinstance(record, Account):
        return _account_to_dict(record)
    if isinstance(record, Transaction):
        return _transaction_to_dict(record)
    raise TypeError(f"cannot store object of type {type(record).__name__}")


def _dict_to_account(d, line_no):
    try:
        return Account(name=d["name"], kind=d["kind"], currency=d["currency"])
    except KeyError as exc:
        raise StoreError(f"corrupt line {line_no}: missing field {exc.args[0]!r}") from exc
    except ValidationError as exc:
        raise StoreError(f"corrupt line {line_no}: {exc}") from exc


def _dict_to_transaction(d, line_no):
    try:
        entries = [
            Entry(account=e["account"], amount=Decimal(e["amount"]), side=e["side"])
            for e in d["entries"]
        ]
        return Transaction(
            id=d["id"], date=d["date"], description=d["description"], entries=entries
        )
    except KeyError as exc:
        raise StoreError(f"corrupt line {line_no}: missing field {exc.args[0]!r}") from exc
    except ValidationError as exc:
        raise StoreError(f"corrupt line {line_no}: {exc}") from exc
    except Exception as exc:  # malformed amount, non-string fields, etc.
        raise StoreError(f"corrupt line {line_no}: {exc}") from exc


class Store:
    """Reads and writes a ledger's accounts and transactions as JSONL.

    Each line of the file is one JSON object: an account record
    ``{"type": "account", "name": ..., "kind": ..., "currency": ...}`` or a
    transaction record ``{"type": "transaction", "id": ..., "date": ...,
    "description": ..., "entries": [{"account": ..., "amount": "12.34",
    "side": "debit"}, ...]}``. Decimal amounts are always serialized as
    strings. Blank lines are ignored.
    """

    def __init__(self, path):
        self.path = Path(path)

    def load(self):
        """Return (accounts, transactions) as lists, in file order.

        Returns ([], []) if the file does not exist. Raises StoreError on a
        line that is not valid JSON, whose "type" is missing or unknown, or
        whose record fields fail account/transaction validation.
        """
        if not self.path.exists():
            return [], []
        accounts = []
        transactions = []
        with open(self.path, "r", encoding="utf-8") as f:
            for line_no, raw in enumerate(f, start=1):
                line = raw.strip()
                if not line:
                    continue
                try:
                    d = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise StoreError(f"corrupt line {line_no}: invalid JSON: {exc}") from exc
                if not isinstance(d, dict) or "type" not in d:
                    raise StoreError(f"corrupt line {line_no}: missing 'type' field")
                if d["type"] == "account":
                    accounts.append(_dict_to_account(d, line_no))
                elif d["type"] == "transaction":
                    transactions.append(_dict_to_transaction(d, line_no))
                else:
                    raise StoreError(
                        f"corrupt line {line_no}: unknown record type {d['type']!r}"
                    )
        return accounts, transactions

    def append(self, record):
        """Append one Account or Transaction to the file with an atomic rewrite.

        The full file contents (existing lines plus the new record) are
        written to a temporary file in the same directory, then moved into
        place with os.replace, so a crash mid-write never corrupts the file.
        """
        lines = []
        if self.path.exists():
            with open(self.path, "r", encoding="utf-8") as f:
                lines = [line.rstrip("\n") for line in f if line.strip()]
        lines.append(json.dumps(_record_to_dict(record), sort_keys=True))
        tmp_path = self.path.with_suffix(self.path.suffix + ".tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
            f.write("\n")
        os.replace(tmp_path, self.path)
PYEOF

cat > ledger/journal.py <<'PYEOF'
"""In-memory journal: the set of accounts and posted transactions."""

from decimal import ROUND_HALF_EVEN, Decimal

from .model import (
    Account,
    DuplicateError,
    Entry,
    NotFoundError,
    Transaction,
    ValidationError,
)

_TWO_PLACES = Decimal("0.01")


class Journal:
    """Holds registered accounts and posted transactions in memory."""

    def __init__(self):
        self._accounts = {}
        self._transactions = []

    def open_account(self, name, kind, currency="USD"):
        """Create and register a new account. Raises DuplicateError if the
        name is already registered."""
        if name in self._accounts:
            raise DuplicateError(f"account already exists: {name}")
        account = Account(name=name, kind=kind, currency=currency)
        self._accounts[name] = account
        return account

    def get_account(self, name):
        """Return the registered Account, or raise NotFoundError."""
        try:
            return self._accounts[name]
        except KeyError:
            raise NotFoundError(f"account not found: {name}") from None

    def accounts(self):
        """Return all registered accounts, sorted by name."""
        return sorted(self._accounts.values(), key=lambda a: a.name)

    def transactions(self):
        """Return all posted transactions in post order."""
        return list(self._transactions)

    def _next_transaction_id(self):
        nums = [
            int(t.id[1:])
            for t in self._transactions
            if t.id.startswith("T") and t.id[1:].isdigit()
        ]
        return f"T{(max(nums) + 1) if nums else 1:04d}"

    def post(self, date, description, entries, tx_id=None):
        """Post a transaction.

        `entries` is a list of (account_name, amount, side) tuples, amount a
        Decimal. Raises DuplicateError if tx_id is given and already used,
        NotFoundError if an entry references an unregistered account,
        ValidationError if the referenced accounts do not share a single
        currency or if the resulting Transaction fails its own validation
        (at least two entries, balanced, valid date).
        """
        if tx_id is not None and any(t.id == tx_id for t in self._transactions):
            raise DuplicateError(f"transaction id already exists: {tx_id}")

        currencies = set()
        for account_name, _amount, _side in entries:
            account = self.get_account(account_name)
            currencies.add(account.currency)
        if len(currencies) > 1:
            raise ValidationError(
                f"currency mismatch in transaction: {sorted(currencies)}"
            )

        new_id = tx_id if tx_id is not None else self._next_transaction_id()
        entry_objs = [
            Entry(account=account_name, amount=amount, side=side)
            for account_name, amount, side in entries
        ]
        tx = Transaction(id=new_id, date=date, description=description, entries=entry_objs)
        self._transactions.append(tx)
        return tx

    def balance(self, account_name, as_of=None):
        """Return the normal-balance-signed balance of `account_name`.

        Asset and expense accounts are normal-debit (balance = debits -
        credits); liability, equity, and income accounts are normal-credit
        (balance = credits - debits). Only transactions dated on or before
        `as_of` (an ISO "YYYY-MM-DD" string) are included when given. The
        result is quantized to 2 decimal places with ROUND_HALF_EVEN.
        """
        account = self.get_account(account_name)
        debit_total = Decimal("0")
        credit_total = Decimal("0")
        for tx in self._transactions:
            if as_of is not None and tx.date > as_of:
                continue
            for e in tx.entries:
                if e.account != account_name:
                    continue
                if e.side == "debit":
                    debit_total += e.amount
                else:
                    credit_total += e.amount
        if account.kind in ("asset", "expense"):
            raw = debit_total - credit_total
        else:
            raw = credit_total - debit_total
        return raw.quantize(_TWO_PLACES, rounding=ROUND_HALF_EVEN)

    def close_period(
        self, as_of, income_summary="Income Summary", retained_earnings="Retained Earnings"
    ):
        """Close all income and expense account balances (as of `as_of`,
        inclusive) into `income_summary`, then close `income_summary`'s net
        balance into `retained_earnings`. Both must already be registered
        accounts. Returns the single closing Transaction. Raises
        ValidationError("nothing to close") if every income and expense
        account has a zero balance as of `as_of`.
        """
        self.get_account(income_summary)
        self.get_account(retained_earnings)

        entries = []
        net = Decimal("0")
        for account in self.accounts():
            if account.kind not in ("income", "expense"):
                continue
            bal = self.balance(account.name, as_of=as_of)
            if bal == 0:
                continue
            if account.kind == "income":
                net += bal
            else:
                net -= bal
            if bal > 0:
                # zero out a normal (positive) balance
                zero_side = "debit" if account.kind == "income" else "credit"
            else:
                zero_side = "credit" if account.kind == "income" else "debit"
            amount = abs(bal)
            entries.append((account.name, amount, zero_side))
            entries.append(
                (income_summary, amount, "credit" if zero_side == "debit" else "debit")
            )

        if not entries:
            raise ValidationError("nothing to close")

        if net > 0:
            entries.append((income_summary, net, "debit"))
            entries.append((retained_earnings, net, "credit"))
        elif net < 0:
            amount = abs(net)
            entries.append((income_summary, amount, "credit"))
            entries.append((retained_earnings, amount, "debit"))

        return self.post(as_of, f"Close period as of {as_of}", entries)

    @classmethod
    def load(cls, store):
        """Build a Journal from everything persisted in `store`."""
        journal = cls()
        accounts, transactions = store.load()
        for account in accounts:
            if account.name in journal._accounts:
                raise DuplicateError(f"account already exists: {account.name}")
            journal._accounts[account.name] = account
        seen_ids = set()
        for tx in transactions:
            if tx.id in seen_ids:
                raise DuplicateError(f"transaction id already exists: {tx.id}")
            seen_ids.add(tx.id)
            journal._transactions.append(tx)
        return journal
PYEOF

cat > ledger/report.py <<'PYEOF'
"""Reports derived from a Journal: trial balance, account statements, CSV."""

import csv
import io
from decimal import ROUND_HALF_EVEN, Decimal

_TWO_PLACES = Decimal("0.01")


def _quant(x):
    return x.quantize(_TWO_PLACES, rounding=ROUND_HALF_EVEN)


def trial_balance(journal, as_of=None):
    """Return a list of (account_name, debit, credit) tuples, one row per
    registered account, sorted by account name ascending.

    For each account this uses the RAW entries posted to it (not the
    normal-balance sign convention used by Journal.balance): debit =
    max(debit_total - credit_total, 0), credit = max(credit_total -
    debit_total, 0), each quantized to 2 decimal places. Because every
    posted transaction balances, sum(debit column) always equals sum(credit
    column). `as_of` filters to transactions dated on or before it.
    """
    totals = {a.name: [Decimal("0"), Decimal("0")] for a in journal.accounts()}
    for tx in journal.transactions():
        if as_of is not None and tx.date > as_of:
            continue
        for e in tx.entries:
            if e.account not in totals:
                continue
            if e.side == "debit":
                totals[e.account][0] += e.amount
            else:
                totals[e.account][1] += e.amount

    rows = []
    for name in sorted(totals):
        debit_total, credit_total = totals[name]
        net = debit_total - credit_total
        debit = _quant(net) if net > 0 else _quant(Decimal("0"))
        credit = _quant(-net) if net < 0 else _quant(Decimal("0"))
        rows.append((name, debit, credit))
    return rows


def statement(journal, account_name, start=None, end=None):
    """Return a list of (date, tx_id, description, debit, credit, balance)
    tuples for every entry posted to `account_name` whose transaction date
    falls within [start, end] inclusive (None on either side means
    unbounded), ordered by (date, tx_id) ascending.

    `balance` is the running normal-balance-signed balance (per
    Journal.balance's sign convention) after applying that entry, starting
    from 0. All amounts are quantized to 2 decimal places.
    """
    account = journal.get_account(account_name)
    normal_debit = account.kind in ("asset", "expense")

    rows = []
    for tx in journal.transactions():
        if start is not None and tx.date < start:
            continue
        if end is not None and tx.date > end:
            continue
        for e in tx.entries:
            if e.account == account_name:
                rows.append((tx.date, tx.id, tx.description, e.side, e.amount))
    rows.sort(key=lambda r: (r[0], r[1]))

    running = Decimal("0")
    result = []
    for date, tx_id, description, side, amount in rows:
        signed = amount if side == "debit" else -amount
        if not normal_debit:
            signed = -signed
        running = _quant(running + signed)
        debit = _quant(amount) if side == "debit" else _quant(Decimal("0"))
        credit = _quant(amount) if side == "credit" else _quant(Decimal("0"))
        result.append((date, tx_id, description, debit, credit, running))
    return result


def to_csv(rows):
    """Serialize trial_balance() rows to CSV text.

    Header is "account,debit,credit"; each row is "name,12.34,56.78". Uses
    "\\n" line endings and returns the whole thing as one string.
    """
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["account", "debit", "credit"])
    for name, debit, credit in rows:
        writer.writerow([name, f"{debit:.2f}", f"{credit:.2f}"])
    return buf.getvalue()
PYEOF

cat > ledger/importer.py <<'PYEOF'
"""CSV import: turn rows of (date, description, account, amount, side) into
balanced transactions and post them to a Journal."""

import csv
from decimal import Decimal, InvalidOperation

from .model import NotFoundError, ValidationError

EXPECTED_HEADER = ["date", "description", "account", "amount", "side"]


def _dup_key(date, description, entries):
    total_debit = sum((amt for _a, amt, side in entries if side == "debit"), Decimal("0"))
    return (date, description, total_debit)


def _existing_dup_key(tx):
    total_debit = sum(
        (e.amount for e in tx.entries if e.side == "debit"), Decimal("0")
    )
    return (tx.date, tx.description, total_debit)


def import_csv(journal, path):
    """Import transactions from the CSV file at `path`.

    The file must have the exact header "date,description,account,amount,side"
    (raises ValidationError otherwise). Consecutive rows sharing the same
    (date, description) are grouped into a single transaction; a change in
    that pair starts a new group. Each group is posted via journal.post.

    Duplicate detection: a group whose (date, description, total debit
    amount) matches a transaction already in the journal, or one already
    imported earlier in this same call, is silently skipped (not an error).

    A row with a wrong number of columns, an unparsable amount, or a side
    that is not "debit"/"credit" causes its whole group to be skipped and
    recorded in the returned errors list as (line_no, message), using the
    physical 1-indexed line number of the offending row (the header is line
    1). A group that fails journal.post (unknown account, unbalanced
    entries, etc.) is likewise skipped and recorded, using the line number
    of the group's last row.

    Returns (imported, errors): imported is the list of Transaction objects
    successfully posted, in posting order.
    """
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        try:
            header = next(reader)
        except StopIteration:
            raise ValidationError("empty CSV file: missing header")
        if header != EXPECTED_HEADER:
            raise ValidationError(
                f"invalid CSV header: expected {EXPECTED_HEADER}, got {header}"
            )
        rows = list(enumerate(reader, start=2))

    groups = []
    current_key = None
    current_group = []
    for line_no, row in rows:
        key = (row[0] if len(row) > 0 else None, row[1] if len(row) > 1 else None)
        if current_group and key != current_key:
            groups.append(current_group)
            current_group = []
        current_key = key
        current_group.append((line_no, row))
    if current_group:
        groups.append(current_group)

    seen = {_existing_dup_key(tx) for tx in journal.transactions()}
    imported = []
    errors = []

    for group in groups:
        date, description = group[0][1][0], group[0][1][1]
        parsed_entries = []
        row_errors = []
        for line_no, row in group:
            if len(row) != 5:
                row_errors.append((line_no, f"expected 5 columns, got {len(row)}"))
                continue
            _date, _desc, account, amount_str, side = row
            if side not in ("debit", "credit"):
                row_errors.append((line_no, f"invalid side: {side!r}"))
                continue
            try:
                amount = Decimal(amount_str)
            except InvalidOperation:
                row_errors.append((line_no, f"invalid amount: {amount_str!r}"))
                continue
            parsed_entries.append((account, amount, side))

        if row_errors:
            errors.extend(row_errors)
            continue

        key = _dup_key(date, description, parsed_entries)
        if key in seen:
            continue

        last_line_no = group[-1][0]
        try:
            tx = journal.post(date, description, parsed_entries)
        except (NotFoundError, ValidationError) as exc:
            errors.append((last_line_no, str(exc)))
            continue

        imported.append(tx)
        seen.add(key)

    return imported, errors
PYEOF

cat > ledger/cli.py <<'PYEOF'
"""Command-line interface for the ledger."""

import argparse
import sys
from decimal import Decimal, InvalidOperation

from . import importer, report
from .journal import Journal
from .model import DuplicateError, LedgerError, NotFoundError, ValidationError
from .store import Store, StoreError


def _build_parser():
    parser = argparse.ArgumentParser(prog="ledger")
    parser.add_argument("--file", required=True, help="path to the JSONL ledger file")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init")

    p = sub.add_parser("add-account")
    p.add_argument("name")
    p.add_argument("kind")
    p.add_argument("--currency", default="USD")

    p = sub.add_parser("post")
    p.add_argument("--date", required=True)
    p.add_argument("--description", required=True)
    p.add_argument("--entry", action="append", default=[], dest="entries")
    p.add_argument("--id", dest="tx_id", default=None)

    p = sub.add_parser("balance")
    p.add_argument("account")
    p.add_argument("--as-of", dest="as_of", default=None)

    p = sub.add_parser("trial-balance")
    p.add_argument("--as-of", dest="as_of", default=None)
    p.add_argument("--format", choices=["text", "csv"], default="text")

    p = sub.add_parser("statement")
    p.add_argument("account")
    p.add_argument("--start", default=None)
    p.add_argument("--end", default=None)
    p.add_argument("--format", choices=["text", "csv"], default="text")

    p = sub.add_parser("import")
    p.add_argument("csv_path")

    p = sub.add_parser("export")
    p.add_argument("--out", default=None)

    return parser


def _parse_entry(spec):
    parts = spec.split(":")
    if len(parts) != 3:
        raise ValidationError(f"invalid --entry value: {spec!r}")
    account, amount_str, side = parts
    try:
        amount = Decimal(amount_str)
    except InvalidOperation:
        raise ValidationError(f"invalid --entry value: {spec!r}") from None
    return account, amount, side


def main(argv):
    """Run the ledger CLI. Returns the process exit code:
    0 on success, 1 on a validation/content error, 2 on a usage error.
    """
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 2

    store = Store(args.file)

    try:
        if args.command == "init":
            if store.path.exists():
                print(f"Error: ledger already exists: {args.file}", file=sys.stderr)
                return 1
            store.path.touch()
            print(f"Initialized ledger at {args.file}")
            return 0

        journal = Journal.load(store)

        if args.command == "add-account":
            account = journal.open_account(args.name, args.kind, args.currency)
            store.append(account)
            print(f"Created account {account.name} ({account.kind}, {account.currency})")
            return 0

        if args.command == "post":
            entries = [_parse_entry(e) for e in args.entries]
            tx = journal.post(args.date, args.description, entries, tx_id=args.tx_id)
            store.append(tx)
            print(f"Posted {tx.id}")
            return 0

        if args.command == "balance":
            bal = journal.balance(args.account, as_of=args.as_of)
            print(f"{args.account}: {bal}")
            return 0

        if args.command == "trial-balance":
            rows = report.trial_balance(journal, as_of=args.as_of)
            if args.format == "csv":
                sys.stdout.write(report.to_csv(rows))
            else:
                total_debit = Decimal("0")
                total_credit = Decimal("0")
                for name, debit, credit in rows:
                    total_debit += debit
                    total_credit += credit
                    print(f"{name}: debit {debit:.2f} credit {credit:.2f}")
                print(f"TOTAL: debit {total_debit:.2f} credit {total_credit:.2f}")
            return 0

        if args.command == "statement":
            rows = report.statement(journal, args.account, start=args.start, end=args.end)
            if args.format == "csv":
                import csv
                import io

                buf = io.StringIO()
                writer = csv.writer(buf, lineterminator="\n")
                writer.writerow(["date", "tx_id", "description", "debit", "credit", "balance"])
                for date, tx_id, description, debit, credit, running in rows:
                    writer.writerow(
                        [date, tx_id, description, f"{debit:.2f}", f"{credit:.2f}", f"{running:.2f}"]
                    )
                sys.stdout.write(buf.getvalue())
            else:
                print(f"Statement for {args.account}")
                for date, tx_id, description, debit, credit, running in rows:
                    print(
                        f"{date} {tx_id} {description}: debit {debit:.2f} "
                        f"credit {credit:.2f} balance {running:.2f}"
                    )
            return 0

        if args.command == "import":
            imported, errors = importer.import_csv(journal, args.csv_path)
            for tx in imported:
                store.append(tx)
            print(f"Imported {len(imported)} transaction(s)")
            if errors:
                for line_no, message in errors:
                    print(f"line {line_no}: {message}", file=sys.stderr)
                print(f"{len(errors)} error(s)", file=sys.stderr)
                return 1
            return 0

        if args.command == "export":
            rows = [
                (tx.date, tx.description, e.account, e.amount, e.side)
                for tx in journal.transactions()
                for e in tx.entries
            ]
            import csv
            import io

            buf = io.StringIO()
            writer = csv.writer(buf, lineterminator="\n")
            writer.writerow(["date", "description", "account", "amount", "side"])
            for date, description, account, amount, side in rows:
                writer.writerow([date, description, account, f"{amount:.2f}", side])
            content = buf.getvalue()
            if args.out:
                with open(args.out, "w", encoding="utf-8") as f:
                    f.write(content)
                print(f"Exported {len(rows)} entries to {args.out}")
            else:
                sys.stdout.write(content)
            return 0

    except StoreError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except (ValidationError, NotFoundError, DuplicateError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except LedgerError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except FileNotFoundError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    parser.error(f"unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
PYEOF

