"""Hidden regression tests: behaviour TASK.md does not touch must still
work exactly as before."""

import pytest

from invsys.errors import ConflictError, NotFoundError, ValidationError
from invsys.models.product import Product
from invsys.repos.customer_repo import CustomerRepo
from invsys.repos.invoice_repo import InvoiceRepo
from invsys.repos.order_repo import OrderRepo
from invsys.repos.product_repo import ProductRepo
from invsys.repos.shipment_repo import ShipmentRepo
from invsys.repos.stock_level_repo import StockLevelRepo
from invsys.repos.supplier_repo import SupplierRepo
from invsys.repos.warehouse_repo import WarehouseRepo
from invsys.services.customer_service import CustomerService
from invsys.services.invoice_service import InvoiceService
from invsys.services.order_service import OrderService
from invsys.services.product_service import ProductService
from invsys.services.shipment_service import ShipmentService
from invsys.services.stock_service import StockService
from invsys.services.supplier_service import SupplierService
from invsys.services.warehouse_service import WarehouseService


def test_product_validation_still_raises():
    with pytest.raises(ValidationError):
        Product(id="PRD-1", sku="", name="N", category="c", unit_price=1.0, reorder_threshold=1)


def test_repo_add_get_list_update_unaffected():
    repo = ProductRepo()
    repo.add(Product(id="PRD-1", sku="S", name="N", category="c", unit_price=1.0, reorder_threshold=1))
    assert repo.get("PRD-1").sku == "S"
    assert len(repo.list()) == 1
    repo.update("PRD-1", unit_price=5.0)
    assert repo.get("PRD-1").unit_price == 5.0


def test_warehouse_service_full_crud_still_works():
    service = WarehouseService(WarehouseRepo())
    w = service.create_warehouse(code="C1", name="Main", region="us", capacity=10)
    assert service.get_warehouse(w.id).code == "C1"
    assert len(service.list_warehouses()) == 1
    updated = service.update_warehouse(w.id, capacity=20)
    assert updated.capacity == 20
    with pytest.raises(NotFoundError):
        service.get_warehouse("nope")


def test_supplier_service_full_crud_still_works():
    service = SupplierService(SupplierRepo())
    s = service.create_supplier(name="Acme", contact_email="a@acme.com", region="us", rating=4)
    assert service.get_supplier(s.id).rating == 4
    assert len(service.list_suppliers()) == 1


def test_shipment_and_invoice_services_still_work():
    order_repo, customer_repo, warehouse_repo, product_repo = OrderRepo(), CustomerRepo(), WarehouseRepo(), ProductRepo()
    order_service = OrderService(order_repo, customer_repo, warehouse_repo, product_repo)
    ps = ProductService(product_repo)
    ws = WarehouseService(warehouse_repo)
    cs = CustomerService(customer_repo)
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    w = ws.create_warehouse(code="C1", name="W", region="us", capacity=10)
    c = cs.create_customer(name="Alice", email="a@example.com", tier="standard", credit_limit=100)
    o = order_service.place_order(customer_id=c.id, warehouse_id=w.id, product_id=p.id, quantity=1)

    shipment_service = ShipmentService(ShipmentRepo(), order_repo)
    sh = shipment_service.create_shipment(order_id=o.id, warehouse_id=w.id, carrier="UPS", tracking_code="T1")
    assert shipment_service.get_shipment(sh.id).status == "pending"

    invoice_service = InvoiceService(InvoiceRepo(), order_repo, customer_repo)
    inv = invoice_service.create_invoice(order_id=o.id, customer_id=c.id, amount=9.99)
    assert invoice_service.update_invoice(inv.id, status="paid").status == "paid"


def test_stock_reserve_conflict_still_raised():
    product_repo, stock_repo = ProductRepo(), StockLevelRepo()
    ps = ProductService(product_repo)
    ss = StockService(stock_repo, product_repo)
    p = ps.create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    ss.create_level(product_id=p.id, warehouse_id="WHS-1", quantity=3)
    ss.reserve(p.id, "WHS-1", 3)
    with pytest.raises(ConflictError):
        ss.reserve(p.id, "WHS-1", 1)


def test_place_order_still_validates_foreign_ids():
    order_repo, customer_repo, warehouse_repo, product_repo = OrderRepo(), CustomerRepo(), WarehouseRepo(), ProductRepo()
    service = OrderService(order_repo, customer_repo, warehouse_repo, product_repo)
    with pytest.raises(NotFoundError):
        service.place_order(customer_id="nope", warehouse_id="WHS-1", product_id="PRD-1", quantity=1)


def test_router_still_dispatches_unknown_action_to_404():
    from invsys.api import router
    status, body = router.route("product", "bogus", None, {})
    assert status == 404
