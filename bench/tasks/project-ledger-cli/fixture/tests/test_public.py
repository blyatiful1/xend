"""Public example tests: a small subset of the hidden suite's happy paths.

These are here so you can sanity-check your implementation as you build it.
The hidden grading suite covers every requirement in SPEC.md in much more
depth (including every error path) — do not treat this file as complete.
"""

from decimal import Decimal

from ledger.cli import main
from ledger.journal import Journal
from ledger.report import trial_balance
from ledger.store import Store


def make_journal():
    j = Journal()
    j.open_account("Cash", "asset")
    j.open_account("Revenue", "income")
    j.open_account("Expenses", "expense")
    return j


def test_post_auto_generates_sequential_ids():
    j = make_journal()
    t1 = j.post("2024-01-01", "a", [("Cash", Decimal("10"), "debit"), ("Revenue", Decimal("10"), "credit")])
    t2 = j.post("2024-01-02", "b", [("Cash", Decimal("5"), "debit"), ("Revenue", Decimal("5"), "credit")])
    assert t1.id == "T0001"
    assert t2.id == "T0002"


def test_balance_asset_normal_debit():
    j = make_journal()
    j.post("2024-01-01", "a", [("Cash", Decimal("100"), "debit"), ("Revenue", Decimal("100"), "credit")])
    j.post("2024-01-02", "b", [("Expenses", Decimal("40"), "debit"), ("Cash", Decimal("40"), "credit")])
    assert j.balance("Cash") == Decimal("60.00")


def test_trial_balance_totals_match():
    j = make_journal()
    j.post("2024-01-01", "Sale", [("Cash", Decimal("100"), "debit"), ("Revenue", Decimal("100"), "credit")])
    j.post("2024-01-15", "Rent", [("Expenses", Decimal("40"), "debit"), ("Cash", Decimal("40"), "credit")])
    rows = trial_balance(j)
    total_debit = sum((d for _n, d, _c in rows), Decimal("0"))
    total_credit = sum((c for _n, _d, c in rows), Decimal("0"))
    assert total_debit == total_credit


def test_append_and_load_account_roundtrip(tmp_path):
    from ledger.model import Account

    store = Store(tmp_path / "book.jsonl")
    store.append(Account(name="Cash", kind="asset", currency="USD"))
    accounts, transactions = store.load()
    assert len(accounts) == 1
    assert accounts[0].name == "Cash"
    assert accounts[0].kind == "asset"
    assert accounts[0].currency == "USD"
    assert transactions == []


def test_cli_post_success_and_balance(tmp_path, capsys):
    path = tmp_path / "book.jsonl"
    main(["--file", str(path), "init"])
    main(["--file", str(path), "add-account", "Cash", "asset"])
    main(["--file", str(path), "add-account", "Revenue", "income"])
    capsys.readouterr()

    rc = main(
        ["--file", str(path), "post", "--date", "2024-01-01", "--description", "Sale",
         "--entry", "Cash:100.00:debit", "--entry", "Revenue:100.00:credit"]
    )
    out = capsys.readouterr().out
    assert rc == 0
    assert "Posted T0001" in out

    rc = main(["--file", str(path), "balance", "Cash"])
    out = capsys.readouterr().out
    assert rc == 0
    assert out.strip() == "Cash: 100.00"
