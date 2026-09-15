from decimal import Decimal

import pytest

from ledger.journal import Journal
from ledger.model import NotFoundError
from ledger.report import statement, to_csv, trial_balance


def make_journal():
    j = Journal()
    j.open_account("Cash", "asset")
    j.open_account("Revenue", "income")
    j.open_account("Expenses", "expense")
    j.post("2024-01-01", "Sale", [("Cash", Decimal("100"), "debit"), ("Revenue", Decimal("100"), "credit")])
    j.post("2024-01-15", "Rent", [("Expenses", Decimal("40"), "debit"), ("Cash", Decimal("40"), "credit")])
    return j


def test_trial_balance_totals_match():
    j = make_journal()
    rows = trial_balance(j)
    total_debit = sum((d for _n, d, _c in rows), Decimal("0"))
    total_credit = sum((c for _n, _d, c in rows), Decimal("0"))
    assert total_debit == total_credit


def test_trial_balance_includes_zero_balance_accounts():
    j = Journal()
    j.open_account("Untouched", "asset")
    rows = trial_balance(j)
    assert rows == [("Untouched", Decimal("0.00"), Decimal("0.00"))]


def test_trial_balance_sorted_by_name():
    j = Journal()
    j.open_account("Zeta", "asset")
    j.open_account("Alpha", "asset")
    rows = trial_balance(j)
    assert [r[0] for r in rows] == ["Alpha", "Zeta"]


def test_trial_balance_as_of_filter():
    j = make_journal()
    j.post("2024-02-01", "Later", [("Cash", Decimal("10"), "debit"), ("Revenue", Decimal("10"), "credit")])
    rows = {name: (d, c) for name, d, c in trial_balance(j, as_of="2024-01-31")}
    assert rows["Cash"] == (Decimal("60.00"), Decimal("0.00"))


def test_statement_running_balance():
    j = make_journal()
    rows = statement(j, "Cash")
    assert len(rows) == 2
    date0, tx0, desc0, debit0, credit0, bal0 = rows[0]
    assert date0 == "2024-01-01"
    assert debit0 == Decimal("100.00")
    assert bal0 == Decimal("100.00")
    date1, tx1, desc1, debit1, credit1, bal1 = rows[1]
    assert credit1 == Decimal("40.00")
    assert bal1 == Decimal("60.00")


def test_statement_start_end_filter():
    j = make_journal()
    j.post("2024-03-01", "Later", [("Cash", Decimal("5"), "debit"), ("Revenue", Decimal("5"), "credit")])
    rows = statement(j, "Cash", start="2024-01-10", end="2024-01-31")
    assert len(rows) == 1
    assert rows[0][0] == "2024-01-15"


def test_statement_unknown_account_raises():
    j = make_journal()
    with pytest.raises(NotFoundError):
        statement(j, "Nope")


def test_to_csv_format():
    rows = [("Cash", Decimal("60.00"), Decimal("0.00")), ("Revenue", Decimal("0.00"), Decimal("100.00"))]
    text = to_csv(rows)
    lines = text.splitlines()
    assert lines[0] == "account,debit,credit"
    assert lines[1] == "Cash,60.00,0.00"
    assert lines[2] == "Revenue,0.00,100.00"
    assert "\r\n" not in text
