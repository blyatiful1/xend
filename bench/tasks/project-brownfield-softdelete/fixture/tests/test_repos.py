"""Public example tests for the repo layer (add/get/list/update)."""

from invsys.models.product import Product
from invsys.repos.product_repo import ProductRepo
from invsys.repos.warehouse_repo import WarehouseRepo


def make_product(id="PRD-1", sku="SKU1", price=9.99):
    return Product(id=id, sku=sku, name="Widget", category="tools",
                    unit_price=price, reorder_threshold=5, active=True)


def test_add_and_get():
    repo = ProductRepo()
    repo.add(make_product())
    found = repo.get("PRD-1")
    assert found is not None
    assert found.sku == "SKU1"


def test_get_missing_returns_none():
    repo = ProductRepo()
    assert repo.get("nope") is None


def test_list_filters_by_field():
    repo = ProductRepo()
    repo.add(make_product(id="PRD-1", sku="A"))
    repo.add(make_product(id="PRD-2", sku="B"))
    matches = repo.list(sku="B")
    assert [p.id for p in matches] == ["PRD-2"]


def test_list_insertion_order():
    repo = ProductRepo()
    repo.add(make_product(id="PRD-1"))
    repo.add(make_product(id="PRD-2", sku="SKU2"))
    assert [p.id for p in repo.list()] == ["PRD-1", "PRD-2"]


def test_update_applies_changes():
    repo = ProductRepo()
    repo.add(make_product())
    updated = repo.update("PRD-1", unit_price=5.0)
    assert updated.unit_price == 5.0
    assert repo.get("PRD-1").unit_price == 5.0


def test_update_missing_returns_none():
    repo = ProductRepo()
    assert repo.update("nope", unit_price=1.0) is None


def test_find_by_sku():
    repo = ProductRepo()
    repo.add(make_product(id="PRD-1", sku="ABC"))
    found = repo.find_by_sku("ABC")
    assert found is not None
    assert found.id == "PRD-1"
    assert repo.find_by_sku("missing") is None


def test_warehouse_repo_find_by_code():
    from invsys.models.warehouse import Warehouse
    repo = WarehouseRepo()
    repo.add(Warehouse(id="WHS-1", code="MAIN", name="Main", region="us", capacity=100))
    assert repo.find_by_code("MAIN").id == "WHS-1"
