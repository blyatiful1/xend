from decimal import Decimal

import pytest

from ledger.model import (
    Account,
    DuplicateError,
    Entry,
    LedgerError,
    NotFoundError,
    Transaction,
    ValidationError,
)


def test_exception_hierarchy():
    assert issubclass(ValidationError, LedgerError)
    assert issubclass(NotFoundError, LedgerError)
    assert issubclass(DuplicateError, LedgerError)
    assert issubclass(LedgerError, Exception)


def test_account_invalid_kind():
    with pytest.raises(ValidationError):
        Account(name="Cash", kind="bogus")


def test_account_invalid_empty_name():
    with pytest.raises(ValidationError):
        Account(name="", kind="asset")


def test_entry_invalid_side():
    with pytest.raises(ValidationError):
        Entry(account="Cash", amount=Decimal("1.00"), side="sideways")


def test_entry_amount_must_be_decimal():
    with pytest.raises(ValidationError):
        Entry(account="Cash", amount=5, side="debit")


def test_entry_amount_must_be_positive():
    with pytest.raises(ValidationError):
        Entry(account="Cash", amount=Decimal("0"), side="debit")
    with pytest.raises(ValidationError):
        Entry(account="Cash", amount=Decimal("-1"), side="debit")


def test_transaction_requires_two_entries():
    entries = [Entry(account="Cash", amount=Decimal("10"), side="debit")]
    with pytest.raises(ValidationError):
        Transaction(id="T0001", date="2024-01-01", description="x", entries=entries)


def test_transaction_must_be_balanced():
    entries = [
        Entry(account="Cash", amount=Decimal("10"), side="debit"),
        Entry(account="Revenue", amount=Decimal("5"), side="credit"),
    ]
    with pytest.raises(ValidationError):
        Transaction(id="T0001", date="2024-01-01", description="x", entries=entries)


def test_transaction_invalid_date():
    entries = [
        Entry(account="Cash", amount=Decimal("10"), side="debit"),
        Entry(account="Revenue", amount=Decimal("10"), side="credit"),
    ]
    with pytest.raises(ValidationError):
        Transaction(id="T0001", date="01-01-2024", description="x", entries=entries)

