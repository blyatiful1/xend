"""Public example tests: a small subset of the hidden suite's happy
paths for the models layer. Not exhaustive."""

import pytest

from invsys.errors import ValidationError
from invsys.models.customer import Customer
from invsys.models.order import Order
from invsys.models.product import Product
from invsys.models.stock_level import StockLevel


def test_product_to_dict_round_trip():
    p = Product(id="PRD-1", sku="SKU1", name="Widget", category="tools",
                unit_price=9.99, reorder_threshold=5, active=True)
    data = p.to_dict()
    assert data["sku"] == "SKU1"
    assert data["unit_price"] == 9.99
    assert Product.from_dict(data) == p


def test_product_rejects_empty_sku():
    with pytest.raises(ValidationError):
        Product(id="PRD-1", sku="", name="Widget", category="tools",
                 unit_price=1.0, reorder_threshold=1)


def test_product_rejects_negative_price():
    with pytest.raises(ValidationError):
        Product(id="PRD-1", sku="SKU1", name="Widget", category="tools",
                 unit_price=-1.0, reorder_threshold=1)


def test_customer_rejects_bad_tier():
    with pytest.raises(ValidationError):
        Customer(id="CUS-1", name="Alice", email="a@example.com",
                  tier="platinum", credit_limit=100.0)


def test_customer_rejects_email_without_at():
    with pytest.raises(ValidationError):
        Customer(id="CUS-1", name="Alice", email="not-an-email",
                  tier="standard", credit_limit=100.0)


def test_order_rejects_bad_status():
    with pytest.raises(ValidationError):
        Order(id="ORD-1", customer_id="CUS-1", warehouse_id="WHS-1",
              product_id="PRD-1", quantity=1, status="bogus",
              created_at="2024-01-01T00:00:00+00:00")


def test_order_rejects_nonpositive_quantity():
    with pytest.raises(ValidationError):
        Order(id="ORD-1", customer_id="CUS-1", warehouse_id="WHS-1",
              product_id="PRD-1", quantity=0, status="pending",
              created_at="2024-01-01T00:00:00+00:00")


def test_stock_level_from_dict_ignores_unknown_keys():
    level = StockLevel.from_dict(
        {"id": "STK-1", "product_id": "PRD-1", "warehouse_id": "WHS-1",
         "quantity": 10, "reserved": 2, "bogus": "ignored"}
    )
    assert level.quantity == 10
    assert level.reserved == 2
