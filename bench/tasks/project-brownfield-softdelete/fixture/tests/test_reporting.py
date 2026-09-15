"""Public example tests for the reporting layer."""

from invsys.repos.customer_repo import CustomerRepo
from invsys.repos.order_repo import OrderRepo
from invsys.repos.product_repo import ProductRepo
from invsys.repos.stock_level_repo import StockLevelRepo
from invsys.repos.warehouse_repo import WarehouseRepo
from invsys.services.customer_service import CustomerService
from invsys.services.order_service import OrderService
from invsys.services.product_service import ProductService
from invsys.services.reporting import ReportingService
from invsys.services.stock_service import StockService
from invsys.services.warehouse_service import WarehouseService


def build():
    product_repo, warehouse_repo, customer_repo = ProductRepo(), WarehouseRepo(), CustomerRepo()
    order_repo, stock_repo = OrderRepo(), StockLevelRepo()
    ps, ws, cs = ProductService(product_repo), WarehouseService(warehouse_repo), CustomerService(customer_repo)
    os_ = OrderService(order_repo, customer_repo, warehouse_repo, product_repo)
    ss = StockService(stock_repo, product_repo)
    rs = ReportingService(product_repo, order_repo, customer_repo, stock_repo)
    return ps, ws, cs, os_, ss, rs


def test_inventory_summary_counts_active_products_and_stock():
    ps, ws, cs, os_, ss, rs = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=3)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    ss.create_level(product_id=p.id, warehouse_id=w.id, quantity=10)
    summary = rs.inventory_summary()
    assert summary["active_products"] == 1
    assert summary["total_on_hand"] == 10
    assert summary["low_stock_product_ids"] == []


def test_inventory_summary_flags_low_stock():
    ps, ws, cs, os_, ss, rs = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=5)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    ss.create_level(product_id=p.id, warehouse_id=w.id, quantity=2)
    summary = rs.inventory_summary()
    assert summary["low_stock_product_ids"] == [p.id]


def test_order_status_breakdown():
    ps, ws, cs, os_, ss, rs = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    c = cs.create_customer(name="Alice", email="a@example.com", tier="standard", credit_limit=100)
    os_.place_order(customer_id=c.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    os_.place_order(customer_id=c.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    assert rs.order_status_breakdown() == {"pending": 2}


def test_top_customers_orders_by_count():
    ps, ws, cs, os_, ss, rs = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    c1 = cs.create_customer(name="Alice", email="a@example.com", tier="standard", credit_limit=100)
    c2 = cs.create_customer(name="Bob", email="b@example.com", tier="standard", credit_limit=100)
    os_.place_order(customer_id=c1.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    os_.place_order(customer_id=c1.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    os_.place_order(customer_id=c2.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    top = rs.top_customers(2)
    assert top == [(c1.id, 2), (c2.id, 1)]
