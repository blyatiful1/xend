"""Hidden tests: API 404-on-deleted-read, 200+deleted_at on delete, and
the new restore action (TASK.md section 4) for product/order/customer
only."""

from invsys.api import router
from invsys.repos.customer_repo import CustomerRepo
from invsys.repos.product_repo import ProductRepo
from invsys.services.customer_service import CustomerService
from invsys.services.product_service import ProductService


def build_product():
    return ProductService(ProductRepo())


def build_customer():
    return CustomerService(CustomerRepo())


def create_product(service):
    status, body = router.route(
        "product", "create", service,
        {"data": {"sku": "A", "name": "N", "category": "c", "unit_price": 1.0, "reorder_threshold": 1}},
    )
    assert status == 201
    return body["id"]


def create_customer(service):
    status, body = router.route(
        "customer", "create", service,
        {"data": {"name": "Alice", "email": "a@example.com", "tier": "standard", "credit_limit": 100}},
    )
    assert status == 201
    return body["id"]


def test_delete_returns_200_with_just_deleted_at():
    service = build_product()
    pid = create_product(service)
    status, body = router.route("product", "delete", service, {"id": pid})
    assert status == 200
    assert set(body.keys()) == {"deleted_at"}
    assert body["deleted_at"] is not None


def test_delete_missing_id_is_404():
    service = build_product()
    status, body = router.route("product", "delete", service, {"id": "nope"})
    assert status == 404


def test_get_after_delete_is_404():
    service = build_product()
    pid = create_product(service)
    router.route("product", "delete", service, {"id": pid})
    status, body = router.route("product", "get", service, {"id": pid})
    assert status == 404


def test_restore_action_exists_and_returns_full_item():
    service = build_product()
    pid = create_product(service)
    router.route("product", "delete", service, {"id": pid})
    status, body = router.route("product", "restore", service, {"id": pid})
    assert status == 200
    assert body["id"] == pid
    assert body["deleted_at"] is None


def test_restore_missing_id_is_404():
    service = build_product()
    status, body = router.route("product", "restore", service, {"id": "nope"})
    assert status == 404


def test_customer_delete_and_restore_same_contract():
    service = build_customer()
    cid = create_customer(service)
    status, body = router.route("customer", "delete", service, {"id": cid})
    assert status == 200
    assert set(body.keys()) == {"deleted_at"}
    status, body = router.route("customer", "get", service, {"id": cid})
    assert status == 404
    status, body = router.route("customer", "restore", service, {"id": cid})
    assert status == 200
    assert body["deleted_at"] is None


def test_order_actions_registered_include_restore():
    from invsys.api import order_handlers
    assert "restore" in order_handlers.ACTIONS
    assert "delete" in order_handlers.ACTIONS


def test_warehouse_and_supplier_have_no_delete_or_restore_action():
    from invsys.api import warehouse_handlers
    assert "delete" not in warehouse_handlers.WAREHOUSE_ACTIONS
    assert "restore" not in warehouse_handlers.WAREHOUSE_ACTIONS
    assert "delete" not in warehouse_handlers.SUPPLIER_ACTIONS
    assert "restore" not in warehouse_handlers.SUPPLIER_ACTIONS
