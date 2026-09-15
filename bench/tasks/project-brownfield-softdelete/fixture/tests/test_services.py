"""Public example tests for the services layer."""

import pytest

from invsys.errors import ConflictError, NotFoundError
from invsys.repos.customer_repo import CustomerRepo
from invsys.repos.order_repo import OrderRepo
from invsys.repos.product_repo import ProductRepo
from invsys.repos.stock_level_repo import StockLevelRepo
from invsys.repos.warehouse_repo import WarehouseRepo
from invsys.services.customer_service import CustomerService
from invsys.services.order_service import OrderService
from invsys.services.product_service import ProductService
from invsys.services.stock_service import StockService
from invsys.services.warehouse_service import WarehouseService


def build():
    product_repo, warehouse_repo, customer_repo = ProductRepo(), WarehouseRepo(), CustomerRepo()
    order_repo, stock_repo = OrderRepo(), StockLevelRepo()
    product_service = ProductService(product_repo)
    warehouse_service = WarehouseService(warehouse_repo)
    customer_service = CustomerService(customer_repo)
    order_service = OrderService(order_repo, customer_repo, warehouse_repo, product_repo)
    stock_service = StockService(stock_repo, product_repo)
    return product_service, warehouse_service, customer_service, order_service, stock_service


def test_create_product_assigns_id():
    ps, *_ = build()
    p1 = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    p2 = ps.create_product(sku="B", name="N2", category="c", unit_price=2.0, reorder_threshold=1)
    assert p1.id != p2.id
    assert p1.id.startswith("PRD-")


def test_get_product_missing_raises_not_found():
    ps, *_ = build()
    with pytest.raises(NotFoundError):
        ps.get_product("missing")


def test_update_product_changes_field():
    ps, *_ = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    updated = ps.update_product(p.id, unit_price=42.0)
    assert updated.unit_price == 42.0


def test_place_order_happy_path():
    ps, ws, cs, os_, _ = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    c = cs.create_customer(name="Alice", email="a@example.com", tier="standard", credit_limit=100)
    order = os_.place_order(customer_id=c.id, warehouse_id=w.id, product_id=p.id, quantity=2)
    assert order.status == "pending"
    assert order.quantity == 2
    assert order.id.startswith("ORD-")


def test_place_order_missing_customer_raises_not_found():
    ps, ws, cs, os_, _ = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    with pytest.raises(NotFoundError):
        os_.place_order(customer_id="nope", warehouse_id=w.id, product_id=p.id, quantity=1)


def test_stock_reserve_and_conflict():
    ps, ws, cs, os_, ss = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    ss.create_level(product_id=p.id, warehouse_id=w.id, quantity=5)
    level = ss.reserve(p.id, w.id, 3)
    assert level.reserved == 3
    with pytest.raises(ConflictError):
        ss.reserve(p.id, w.id, 10)
