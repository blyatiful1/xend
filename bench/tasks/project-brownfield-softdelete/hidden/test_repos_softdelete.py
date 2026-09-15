"""Hidden tests: BaseRepo soft delete (TASK.md section 2), exercised
through several different entity repos to prove it's generic, not
special-cased per repo."""

from invsys.models.product import Product
from invsys.models.stock_level import StockLevel
from invsys.repos.product_repo import ProductRepo
from invsys.repos.stock_level_repo import StockLevelRepo
from invsys.utils.clock import fixed_clock


def make_product(id="PRD-1"):
    return Product(id=id, sku=id, name="N", category="c", unit_price=1.0, reorder_threshold=1)


def test_repo_accepts_clock_kwarg_defaulting_to_none():
    repo = ProductRepo()
    repo.add(make_product())
    removed = repo.remove("PRD-1")
    assert removed is not None
    assert removed.deleted_at is not None


def test_remove_sets_deleted_at_from_injected_clock():
    repo = ProductRepo(clock=fixed_clock("2030-06-15T00:00:00+00:00"))
    repo.add(make_product())
    removed = repo.remove("PRD-1")
    assert removed.deleted_at == "2030-06-15T00:00:00+00:00"


def test_get_excludes_soft_deleted_by_default():
    repo = ProductRepo(clock=fixed_clock("2030-01-01T00:00:00+00:00"))
    repo.add(make_product())
    repo.remove("PRD-1")
    assert repo.get("PRD-1") is None


def test_get_include_deleted_true_returns_it():
    repo = ProductRepo(clock=fixed_clock("2030-01-01T00:00:00+00:00"))
    repo.add(make_product())
    repo.remove("PRD-1")
    found = repo.get("PRD-1", include_deleted=True)
    assert found is not None
    assert found.id == "PRD-1"


def test_list_excludes_soft_deleted_by_default():
    repo = ProductRepo(clock=fixed_clock("2030-01-01T00:00:00+00:00"))
    repo.add(make_product("PRD-1"))
    repo.add(make_product("PRD-2"))
    repo.remove("PRD-1")
    assert [p.id for p in repo.list()] == ["PRD-2"]


def test_list_include_deleted_true_includes_it():
    repo = ProductRepo(clock=fixed_clock("2030-01-01T00:00:00+00:00"))
    repo.add(make_product("PRD-1"))
    repo.add(make_product("PRD-2"))
    repo.remove("PRD-1")
    assert {p.id for p in repo.list(include_deleted=True)} == {"PRD-1", "PRD-2"}


def test_purge_hard_deletes_regardless_of_deleted_at():
    repo = ProductRepo(clock=fixed_clock("2030-01-01T00:00:00+00:00"))
    repo.add(make_product())
    repo.remove("PRD-1")
    purged = repo.purge("PRD-1")
    assert purged is not None
    assert repo.get("PRD-1", include_deleted=True) is None


def test_purge_missing_id_returns_none():
    repo = ProductRepo()
    assert repo.purge("nope") is None


def test_update_still_operates_on_soft_deleted_rows():
    repo = ProductRepo(clock=fixed_clock("2030-01-01T00:00:00+00:00"))
    repo.add(make_product())
    repo.remove("PRD-1")
    updated = repo.update("PRD-1", unit_price=42.0)
    assert updated is not None
    assert updated.unit_price == 42.0


def test_remove_again_refreshes_deleted_at():
    repo = ProductRepo(clock=fixed_clock("2030-01-01T00:00:00+00:00"))
    repo.add(make_product())
    repo.remove("PRD-1")
    repo2_view = repo.get("PRD-1", include_deleted=True)
    assert repo2_view.deleted_at == "2030-01-01T00:00:00+00:00"
    repo._clock = fixed_clock("2031-01-01T00:00:00+00:00")
    repo.remove("PRD-1")
    assert repo.get("PRD-1", include_deleted=True).deleted_at == "2031-01-01T00:00:00+00:00"


def test_soft_delete_works_generically_on_a_different_entity_repo():
    # Not just ProductRepo: BaseRepo's soft delete must work for any
    # entity repo that does not override get/list/remove.
    repo = StockLevelRepo(clock=fixed_clock("2030-01-01T00:00:00+00:00"))
    repo.add(StockLevel(id="STK-1", product_id="PRD-1", warehouse_id="WHS-1", quantity=5, reserved=0))
    repo.remove("STK-1")
    assert repo.get("STK-1") is None
    assert repo.get("STK-1", include_deleted=True).deleted_at == "2030-01-01T00:00:00+00:00"
