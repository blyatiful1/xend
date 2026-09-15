"""Hidden tests: every model gets deleted_at (TASK.md section 1)."""

import dataclasses

from invsys.models.base import BaseModel
from invsys.models.customer import Customer
from invsys.models.invoice import Invoice
from invsys.models.order import Order
from invsys.models.product import Product
from invsys.models.shipment import Shipment
from invsys.models.stock_level import StockLevel
from invsys.models.supplier import Supplier
from invsys.models.warehouse import Warehouse


def make_product(**overrides):
    kwargs = dict(id="PRD-1", sku="S", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    kwargs.update(overrides)
    return Product(**kwargs)


def test_base_model_declares_deleted_at_field():
    names = {f.name for f in dataclasses.fields(BaseModel)}
    assert "deleted_at" in names


def test_product_deleted_at_defaults_to_none():
    p = make_product()
    assert p.deleted_at is None


def test_product_deleted_at_can_be_set_via_constructor():
    p = make_product(deleted_at="2030-01-01T00:00:00+00:00")
    assert p.deleted_at == "2030-01-01T00:00:00+00:00"


def test_product_to_dict_includes_deleted_at():
    p = make_product()
    assert p.to_dict()["deleted_at"] is None
    p.deleted_at = "2030-01-01T00:00:00+00:00"
    assert p.to_dict()["deleted_at"] == "2030-01-01T00:00:00+00:00"


def test_product_from_dict_reads_deleted_at():
    data = make_product().to_dict()
    data["deleted_at"] = "2030-01-01T00:00:00+00:00"
    p = Product.from_dict(data)
    assert p.deleted_at == "2030-01-01T00:00:00+00:00"


def test_every_model_has_deleted_at_field():
    instances = [
        make_product(),
        Warehouse(id="WHS-1", code="C", name="N", region="us", capacity=1),
        Supplier(id="SUP-1", name="N", contact_email="a@b.com", region="us", rating=3),
        Customer(id="CUS-1", name="N", email="a@b.com", tier="standard", credit_limit=1.0),
        Order(id="ORD-1", customer_id="CUS-1", warehouse_id="WHS-1", product_id="PRD-1",
              quantity=1, status="pending", created_at="2024-01-01T00:00:00+00:00"),
        Shipment(id="SHP-1", order_id="ORD-1", warehouse_id="WHS-1", carrier="UPS",
                  tracking_code="T1", status="pending"),
        Invoice(id="INV-1", order_id="ORD-1", customer_id="CUS-1", amount=1.0, status="unpaid"),
        StockLevel(id="STK-1", product_id="PRD-1", warehouse_id="WHS-1", quantity=1, reserved=0),
    ]
    for item in instances:
        assert hasattr(item, "deleted_at"), type(item)
        assert item.deleted_at is None
        assert "deleted_at" in item.to_dict()


def test_deleted_at_is_keyword_only_not_positional():
    # Passing every positional field for Product must still work even
    # though BaseModel's deleted_at field comes "before" Product's own
    # fields in MRO -- it must not force deleted_at into position 1.
    p = Product("PRD-1", "S", "N", "c", 1.0, 1)
    assert p.deleted_at is None
    assert p.sku == "S"
