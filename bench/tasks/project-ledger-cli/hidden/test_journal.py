from decimal import Decimal

import pytest

from ledger.journal import Journal
from ledger.model import DuplicateError, NotFoundError, ValidationError
from ledger.store import Store


def make_journal():
    j = Journal()
    j.open_account("Cash", "asset")
    j.open_account("Revenue", "income")
    j.open_account("Expenses", "expense")
    j.open_account("Loan", "liability")
    j.open_account("Equity", "equity")
    return j


def test_open_account_duplicate_raises():
    j = Journal()
    j.open_account("Cash", "asset")
    with pytest.raises(DuplicateError):
        j.open_account("Cash", "asset")


def test_post_auto_generates_sequential_ids():
    j = make_journal()
    t1 = j.post("2024-01-01", "a", [("Cash", Decimal("10"), "debit"), ("Revenue", Decimal("10"), "credit")])
    t2 = j.post("2024-01-02", "b", [("Cash", Decimal("5"), "debit"), ("Revenue", Decimal("5"), "credit")])
    assert t1.id == "T0001"
    assert t2.id == "T0002"


def test_post_with_explicit_id():
    j = make_journal()
    t = j.post(
        "2024-01-01", "a",
        [("Cash", Decimal("10"), "debit"), ("Revenue", Decimal("10"), "credit")],
        tx_id="CUSTOM-1",
    )
    assert t.id == "CUSTOM-1"


def test_post_duplicate_id_raises():
    j = make_journal()
    j.post(
        "2024-01-01", "a",
        [("Cash", Decimal("10"), "debit"), ("Revenue", Decimal("10"), "credit")],
        tx_id="X1",
    )
    with pytest.raises(DuplicateError):
        j.post(
            "2024-01-02", "b",
            [("Cash", Decimal("1"), "debit"), ("Revenue", Decimal("1"), "credit")],
            tx_id="X1",
        )


def test_post_unknown_account_raises_notfound():
    j = make_journal()
    with pytest.raises(NotFoundError):
        j.post("2024-01-01", "a", [("Cash", Decimal("10"), "debit"), ("Nope", Decimal("10"), "credit")])


def test_post_currency_mismatch_raises():
    j = Journal()
    j.open_account("CashUSD", "asset", "USD")
    j.open_account("CashEUR", "asset", "EUR")
    with pytest.raises(ValidationError):
        j.post(
            "2024-01-01", "fx",
            [("CashUSD", Decimal("10"), "debit"), ("CashEUR", Decimal("10"), "credit")],
        )


def test_balance_asset_normal_debit():
    j = make_journal()
    j.post("2024-01-01", "a", [("Cash", Decimal("100"), "debit"), ("Revenue", Decimal("100"), "credit")])
    j.post("2024-01-02", "b", [("Expenses", Decimal("40"), "debit"), ("Cash", Decimal("40"), "credit")])
    assert j.balance("Cash") == Decimal("60.00")


def test_balance_as_of_filters_future_transactions():
    j = make_journal()
    j.post("2024-01-01", "a", [("Cash", Decimal("100"), "debit"), ("Revenue", Decimal("100"), "credit")])
    j.post("2024-02-01", "b", [("Cash", Decimal("50"), "debit"), ("Revenue", Decimal("50"), "credit")])
    assert j.balance("Cash", as_of="2024-01-31") == Decimal("100.00")
    assert j.balance("Cash", as_of="2024-02-01") == Decimal("150.00")


def test_balance_unknown_account_raises():
    j = make_journal()
    with pytest.raises(NotFoundError):
        j.balance("Nope")


def test_close_period_zeroes_income_and_expense_into_retained_earnings():
    j = make_journal()
    j.open_account("Income Summary", "equity")
    j.open_account("Retained Earnings", "equity")
    j.post("2024-01-01", "sale", [("Cash", Decimal("100"), "debit"), ("Revenue", Decimal("100"), "credit")])
    j.post("2024-01-02", "rent", [("Expenses", Decimal("40"), "debit"), ("Cash", Decimal("40"), "credit")])
    j.close_period("2024-01-31")
    assert j.balance("Revenue") == Decimal("0.00")
    assert j.balance("Expenses") == Decimal("0.00")
    assert j.balance("Income Summary") == Decimal("0.00")
    assert j.balance("Retained Earnings") == Decimal("60.00")


def test_close_period_net_loss():
    j = make_journal()
    j.open_account("Income Summary", "equity")
    j.open_account("Retained Earnings", "equity")
    j.post("2024-01-01", "sale", [("Cash", Decimal("20"), "debit"), ("Revenue", Decimal("20"), "credit")])
    j.post("2024-01-02", "rent", [("Expenses", Decimal("50"), "debit"), ("Cash", Decimal("50"), "credit")])
    j.close_period("2024-01-31")
    assert j.balance("Retained Earnings") == Decimal("-30.00")
    assert j.balance("Income Summary") == Decimal("0.00")


def test_close_period_nothing_to_close_raises():
    j = make_journal()
    j.open_account("Income Summary", "equity")
    j.open_account("Retained Earnings", "equity")
    with pytest.raises(ValidationError):
        j.close_period("2024-01-31")


def test_journal_load_from_store_continues_id_sequence(tmp_path):
    store = Store(tmp_path / "book.jsonl")
    j = Journal()
    j.open_account("Cash", "asset")
    j.open_account("Revenue", "income")
    for a in j.accounts():
        store.append(a)
    tx = j.post("2024-01-01", "a", [("Cash", Decimal("10"), "debit"), ("Revenue", Decimal("10"), "credit")])
    store.append(tx)

    reloaded = Journal.load(store)
    assert [t.id for t in reloaded.transactions()] == ["T0001"]
    new_tx = reloaded.post(
        "2024-01-02", "b", [("Cash", Decimal("5"), "debit"), ("Revenue", Decimal("5"), "credit")]
    )
    assert new_tx.id == "T0002"


def test_journal_load_duplicate_account_raises(tmp_path):
    path = tmp_path / "book.jsonl"
    path.write_text(
        '{"type": "account", "name": "Cash", "kind": "asset", "currency": "USD"}\n'
        '{"type": "account", "name": "Cash", "kind": "asset", "currency": "USD"}\n'
    )
    with pytest.raises(DuplicateError):
        Journal.load(Store(path))


def test_journal_load_duplicate_transaction_id_raises(tmp_path):
    path = tmp_path / "book.jsonl"
    path.write_text(
        '{"type": "account", "name": "Cash", "kind": "asset", "currency": "USD"}\n'
        '{"type": "account", "name": "Revenue", "kind": "income", "currency": "USD"}\n'
        '{"type": "transaction", "id": "T0001", "date": "2024-01-01", "description": "a", '
        '"entries": [{"account": "Cash", "amount": "10", "side": "debit"}, '
        '{"account": "Revenue", "amount": "10", "side": "credit"}]}\n'
        '{"type": "transaction", "id": "T0001", "date": "2024-01-02", "description": "b", '
        '"entries": [{"account": "Cash", "amount": "5", "side": "debit"}, '
        '{"account": "Revenue", "amount": "5", "side": "credit"}]}\n'
    )
    with pytest.raises(DuplicateError):
        Journal.load(Store(path))
