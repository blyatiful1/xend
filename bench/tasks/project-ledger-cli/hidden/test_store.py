from decimal import Decimal

import pytest

from ledger.model import Account, Entry, Transaction
from ledger.store import Store, StoreError


def test_load_missing_file_returns_empty(tmp_path):
    store = Store(tmp_path / "nope.jsonl")
    accounts, transactions = store.load()
    assert accounts == []
    assert transactions == []


def test_append_and_load_account_roundtrip(tmp_path):
    store = Store(tmp_path / "book.jsonl")
    store.append(Account(name="Cash", kind="asset", currency="USD"))
    accounts, transactions = store.load()
    assert len(accounts) == 1
    assert accounts[0].name == "Cash"
    assert accounts[0].kind == "asset"
    assert accounts[0].currency == "USD"
    assert transactions == []


def test_append_and_load_transaction_roundtrip_preserves_decimal(tmp_path):
    store = Store(tmp_path / "book.jsonl")
    tx = Transaction(
        id="T0001",
        date="2024-01-01",
        description="Sale",
        entries=[
            Entry(account="Cash", amount=Decimal("10.50"), side="debit"),
            Entry(account="Revenue", amount=Decimal("10.50"), side="credit"),
        ],
    )
    store.append(tx)
    accounts, transactions = store.load()
    assert accounts == []
    assert len(transactions) == 1
    loaded = transactions[0]
    assert loaded.id == "T0001"
    assert loaded.entries[0].amount == Decimal("10.50")
    assert isinstance(loaded.entries[0].amount, Decimal)


def test_load_skips_blank_lines(tmp_path):
    path = tmp_path / "book.jsonl"
    path.write_text(
        '{"type": "account", "name": "Cash", "kind": "asset", "currency": "USD"}\n'
        "\n"
        "   \n"
    )
    accounts, transactions = Store(path).load()
    assert len(accounts) == 1


def test_load_invalid_json_raises_storeerror_with_line_number(tmp_path):
    path = tmp_path / "book.jsonl"
    path.write_text(
        '{"type": "account", "name": "Cash", "kind": "asset", "currency": "USD"}\n'
        "not json at all\n"
    )
    with pytest.raises(StoreError) as exc_info:
        Store(path).load()
    assert "corrupt line 2" in str(exc_info.value)


def test_load_missing_type_field(tmp_path):
    path = tmp_path / "book.jsonl"
    path.write_text('{"name": "Cash"}\n')
    with pytest.raises(StoreError) as exc_info:
        Store(path).load()
    assert "corrupt line 1" in str(exc_info.value)


def test_load_unknown_type(tmp_path):
    path = tmp_path / "book.jsonl"
    path.write_text('{"type": "widget"}\n')
    with pytest.raises(StoreError) as exc_info:
        Store(path).load()
    assert "corrupt line 1" in str(exc_info.value)


def test_load_invalid_account_field_raises_storeerror(tmp_path):
    path = tmp_path / "book.jsonl"
    path.write_text('{"type": "account", "name": "Cash", "kind": "bogus", "currency": "USD"}\n')
    with pytest.raises(StoreError) as exc_info:
        Store(path).load()
    assert "corrupt line 1" in str(exc_info.value)
