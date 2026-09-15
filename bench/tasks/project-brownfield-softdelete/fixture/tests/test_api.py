"""Public example tests for the api layer (router.route)."""

from invsys.api import router
from invsys.repos.product_repo import ProductRepo
from invsys.services.product_service import ProductService


def build_product_service():
    return ProductService(ProductRepo())


def test_route_create_and_get():
    service = build_product_service()
    status, body = router.route(
        "product", "create", service,
        {"data": {"sku": "A", "name": "N", "category": "c", "unit_price": 1.0, "reorder_threshold": 1}},
    )
    assert status == 201
    status, body = router.route("product", "get", service, {"id": body["id"]})
    assert status == 200
    assert body["sku"] == "A"


def test_route_get_missing_is_404():
    service = build_product_service()
    status, body = router.route("product", "get", service, {"id": "missing"})
    assert status == 404
    assert "error" in body


def test_route_create_validation_error_is_400():
    service = build_product_service()
    status, body = router.route(
        "product", "create", service,
        {"data": {"sku": "", "name": "N", "category": "c", "unit_price": 1.0, "reorder_threshold": 1}},
    )
    assert status == 400


def test_route_unknown_resource_is_404():
    status, body = router.route("bogus", "get", None, {})
    assert status == 404


def test_route_unknown_action_is_404():
    service = build_product_service()
    status, body = router.route("product", "bogus", service, {})
    assert status == 404
