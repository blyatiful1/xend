from decimal import Decimal

import pytest

from ledger.importer import import_csv
from ledger.journal import Journal
from ledger.model import ValidationError


def make_journal():
    j = Journal()
    j.open_account("Cash", "asset")
    j.open_account("Revenue", "income")
    return j


def write_csv(tmp_path, text, name="in.csv"):
    path = tmp_path / name
    path.write_text(text)
    return path


def test_import_basic_groups_rows_into_one_transaction(tmp_path):
    j = make_journal()
    path = write_csv(
        tmp_path,
        "date,description,account,amount,side\n"
        "2024-01-01,Sale,Cash,50.00,debit\n"
        "2024-01-01,Sale,Revenue,50.00,credit\n",
    )
    imported, errors = import_csv(j, path)
    assert errors == []
    assert len(imported) == 1
    assert len(imported[0].entries) == 2
    assert j.balance("Cash") == Decimal("50.00")


def test_import_invalid_header_raises(tmp_path):
    j = make_journal()
    path = write_csv(tmp_path, "date,desc,account,amount,side\n")
    with pytest.raises(ValidationError):
        import_csv(j, path)


def test_import_row_error_bad_amount(tmp_path):
    j = make_journal()
    path = write_csv(
        tmp_path,
        "date,description,account,amount,side\n"
        "2024-01-01,Sale,Cash,notanumber,debit\n"
        "2024-01-01,Sale,Revenue,50.00,credit\n",
    )
    imported, errors = import_csv(j, path)
    assert imported == []
    assert len(errors) == 1
    assert errors[0][0] == 2
    assert "notanumber" in errors[0][1] or "amount" in errors[0][1]


def test_import_row_error_bad_side(tmp_path):
    j = make_journal()
    path = write_csv(
        tmp_path,
        "date,description,account,amount,side\n"
        "2024-01-01,Sale,Cash,50.00,sideways\n"
        "2024-01-01,Sale,Revenue,50.00,credit\n",
    )
    imported, errors = import_csv(j, path)
    assert imported == []
    assert len(errors) == 1
    assert errors[0][0] == 2


def test_import_group_error_unbalanced(tmp_path):
    j = make_journal()
    path = write_csv(
        tmp_path,
        "date,description,account,amount,side\n"
        "2024-01-01,Sale,Cash,50.00,debit\n"
        "2024-01-01,Sale,Revenue,40.00,credit\n",
    )
    imported, errors = import_csv(j, path)
    assert imported == []
    assert len(errors) == 1
    assert errors[0][0] == 3


def test_import_group_error_unknown_account(tmp_path):
    j = make_journal()
    path = write_csv(
        tmp_path,
        "date,description,account,amount,side\n"
        "2024-01-01,Sale,Cash,50.00,debit\n"
        "2024-01-01,Sale,Nope,50.00,credit\n",
    )
    imported, errors = import_csv(j, path)
    assert imported == []
    assert len(errors) == 1


def test_import_duplicate_skipped_against_existing_journal(tmp_path):
    j = make_journal()
    j.post("2024-01-01", "Sale", [("Cash", Decimal("50.00"), "debit"), ("Revenue", Decimal("50.00"), "credit")])
    path = write_csv(
        tmp_path,
        "date,description,account,amount,side\n"
        "2024-01-01,Sale,Cash,50.00,debit\n"
        "2024-01-01,Sale,Revenue,50.00,credit\n",
    )
    imported, errors = import_csv(j, path)
    assert imported == []
    assert errors == []
    assert len(j.transactions()) == 1


def test_import_duplicate_skipped_within_same_call(tmp_path):
    j = make_journal()
    path = write_csv(
        tmp_path,
        "date,description,account,amount,side\n"
        "2024-01-01,Sale,Cash,50.00,debit\n"
        "2024-01-01,Sale,Revenue,50.00,credit\n"
        "2024-01-01,Sale,Cash,50.00,debit\n"
        "2024-01-01,Sale,Revenue,50.00,credit\n",
    )
    imported, errors = import_csv(j, path)
    assert len(imported) == 1
    assert errors == []


def test_import_multiple_groups(tmp_path):
    j = make_journal()
    j.open_account("Expenses", "expense")
    path = write_csv(
        tmp_path,
        "date,description,account,amount,side\n"
        "2024-01-01,Sale,Cash,50.00,debit\n"
        "2024-01-01,Sale,Revenue,50.00,credit\n"
        "2024-01-02,Rent,Expenses,20.00,debit\n"
        "2024-01-02,Rent,Cash,20.00,credit\n",
    )
    imported, errors = import_csv(j, path)
    assert errors == []
    assert len(imported) == 2
    assert j.balance("Cash") == Decimal("30.00")
