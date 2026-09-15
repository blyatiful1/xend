"""Hidden tests: delete/restore + include_deleted on ProductService,
OrderService, CustomerService only (TASK.md section 3)."""

import pytest

from invsys.errors import NotFoundError
from invsys.repos.customer_repo import CustomerRepo
from invsys.repos.order_repo import OrderRepo
from invsys.repos.product_repo import ProductRepo
from invsys.repos.warehouse_repo import WarehouseRepo
from invsys.services.customer_service import CustomerService
from invsys.services.order_service import OrderService
from invsys.services.product_service import ProductService
from invsys.services.warehouse_service import WarehouseService


def build():
    product_repo, warehouse_repo, customer_repo = ProductRepo(), WarehouseRepo(), CustomerRepo()
    order_repo = OrderRepo()
    ps = ProductService(product_repo)
    ws = WarehouseService(warehouse_repo)
    cs = CustomerService(customer_repo)
    os_ = OrderService(order_repo, customer_repo, warehouse_repo, product_repo)
    return ps, ws, cs, os_


def test_product_delete_soft_deletes_and_returns_item():
    ps, ws, cs, os_ = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    deleted = ps.delete(p.id)
    assert deleted.id == p.id
    assert deleted.deleted_at is not None


def test_product_delete_missing_id_raises_not_found():
    ps, ws, cs, os_ = build()
    with pytest.raises(NotFoundError):
        ps.delete("nope")


def test_product_get_after_delete_raises_not_found():
    ps, ws, cs, os_ = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    ps.delete(p.id)
    with pytest.raises(NotFoundError):
        ps.get_product(p.id)


def test_product_list_excludes_deleted_by_default_includes_with_flag():
    ps, ws, cs, os_ = build()
    p1 = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    p2 = ps.create_product(sku="B", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    ps.delete(p1.id)
    assert [p.id for p in ps.list_products()] == [p2.id]
    assert {p.id for p in ps.list_products(include_deleted=True)} == {p1.id, p2.id}


def test_product_restore_clears_deleted_at():
    ps, ws, cs, os_ = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    ps.delete(p.id)
    restored = ps.restore(p.id)
    assert restored.deleted_at is None
    assert ps.get_product(p.id).id == p.id


def test_product_restore_missing_id_raises_not_found():
    ps, ws, cs, os_ = build()
    with pytest.raises(NotFoundError):
        ps.restore("nope")


def test_product_delete_twice_is_idempotent_not_an_error():
    ps, ws, cs, os_ = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    ps.delete(p.id)
    again = ps.delete(p.id)  # already deleted -- must not raise
    assert again.deleted_at is not None


def test_customer_delete_and_restore():
    ps, ws, cs, os_ = build()
    c = cs.create_customer(name="Alice", email="a@example.com", tier="standard", credit_limit=100)
    cs.delete(c.id)
    with pytest.raises(NotFoundError):
        cs.get_customer(c.id)
    restored = cs.restore(c.id)
    assert restored.deleted_at is None


def test_order_delete_and_restore():
    ps, ws, cs, os_ = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    c = cs.create_customer(name="Alice", email="a@example.com", tier="standard", credit_limit=100)
    o = os_.place_order(customer_id=c.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    deleted = os_.delete(o.id)
    assert deleted.deleted_at is not None
    with pytest.raises(NotFoundError):
        os_.get_order(o.id)
    restored = os_.restore(o.id)
    assert restored.deleted_at is None


def test_order_list_include_deleted():
    ps, ws, cs, os_ = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    c = cs.create_customer(name="Alice", email="a@example.com", tier="standard", credit_limit=100)
    o = os_.place_order(customer_id=c.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    os_.delete(o.id)
    assert os_.list_orders() == []
    assert len(os_.list_orders(include_deleted=True)) == 1


def test_warehouse_service_has_no_delete_or_restore_out_of_scope():
    ps, ws, cs, os_ = build()
    assert not hasattr(ws, "delete")
    assert not hasattr(ws, "restore")
