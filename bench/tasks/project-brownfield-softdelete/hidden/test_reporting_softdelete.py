"""Hidden tests: reporting.py excludes deleted rows from every aggregate
(TASK.md section 6)."""

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


def test_inventory_summary_excludes_deleted_product_from_active_count():
    ps, ws, cs, os_, ss, rs = build()
    p1 = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    p2 = ps.create_product(sku="B", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    assert rs.inventory_summary()["active_products"] == 2
    ps.delete(p1.id)
    assert rs.inventory_summary()["active_products"] == 1


def test_inventory_summary_excludes_deleted_stock_row_from_total_on_hand():
    ps, ws, cs, os_, ss, rs = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    level = ss.create_level(product_id=p.id, warehouse_id=w.id, quantity=7)
    assert rs.inventory_summary()["total_on_hand"] == 7
    # StockLevelRepo has no delete/restore exposed via a service in this
    # ticket's scope, but the underlying repo's soft delete still works.
    stock_repo = ss.repo
    stock_repo.remove(level.id)
    assert rs.inventory_summary()["total_on_hand"] == 0


def test_order_status_breakdown_excludes_deleted_orders():
    ps, ws, cs, os_, ss, rs = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    c = cs.create_customer(name="Alice", email="a@example.com", tier="standard", credit_limit=100)
    o1 = os_.place_order(customer_id=c.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    o2 = os_.place_order(customer_id=c.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    assert rs.order_status_breakdown() == {"pending": 2}
    os_.delete(o1.id)
    assert rs.order_status_breakdown() == {"pending": 1}


def test_top_customers_excludes_deleted_orders():
    ps, ws, cs, os_, ss, rs = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    c1 = cs.create_customer(name="Alice", email="a@example.com", tier="standard", credit_limit=100)
    c2 = cs.create_customer(name="Bob", email="b@example.com", tier="standard", credit_limit=100)
    o1 = os_.place_order(customer_id=c1.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    os_.place_order(customer_id=c1.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    os_.place_order(customer_id=c2.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    assert rs.top_customers(2) == [(c1.id, 2), (c2.id, 1)]
    os_.delete(o1.id)
    assert rs.top_customers(2) == [(c1.id, 1), (c2.id, 1)]


def test_restored_row_counts_again():
    ps, ws, cs, os_, ss, rs = build()
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    assert rs.inventory_summary()["active_products"] == 1
    ps.delete(p.id)
    assert rs.inventory_summary()["active_products"] == 0
    ps.restore(p.id)
    assert rs.inventory_summary()["active_products"] == 1
