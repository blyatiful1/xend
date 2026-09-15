# TASK: add soft-delete support across invsys

`invsys` currently hard-deletes rows: `BaseRepo.remove(id)` drops the row
from storage forever, and there is no way to recover it or to tell later
that it ever existed. Ops has asked for soft delete instead, at least for
products, orders and customers (the entities the API and CLI actually let
people delete), while keeping the underlying storage layer's soft-delete
support generic across every entity.

Implement exactly the following. Do not change any behaviour this
document does not mention.

## 1. Every model gets `deleted_at`

Every entity dataclass (`Product`, `Warehouse`, `Supplier`, `Customer`,
`Order`, `Shipment`, `Invoice`, `StockLevel`) must have an optional
`deleted_at: str | None = None` field, included in `to_dict()` and
accepted by `from_dict()`, on top of its existing fields.

All eight already inherit from `BaseModel` in `invsys/models/base.py`,
which is where the field belongs — `to_dict`/`from_dict` are already
generic over `dataclasses.fields(self)`, so adding the field to
`BaseModel` alone is sufficient; do not hand-edit the eight model files.
`BaseModel` is not currently a dataclass field container, so `deleted_at`
must be declared with `kw_only=True` (Python 3.11 supports per-field
`kw_only`) — without it, every subclass with a required field declared
after inheriting a defaulted field fails with `TypeError: non-default
argument ... follows default argument`.

## 2. `BaseRepo` (`invsys/repos/base.py`) gets soft delete

This is the one place the storage-layer behaviour changes, and every
entity repo inherits it unchanged (none of the eight `*Repo` classes
override `get`/`list`/`remove`/`__init__`).

- `__init__(self, clock=None)`: store `self._clock = clock or now_iso`
  (import `now_iso` from `invsys.utils.clock`). `now_iso` is already used
  elsewhere in the codebase (e.g. `OrderService`) for the same "injected
  clock, defaulting to wall-clock time" pattern — reuse it, don't invent
  a second clock abstraction.
- `get(self, id, include_deleted=False)`: returns `None` if the id is
  absent, **and also** if the row's `deleted_at is not None` and
  `include_deleted` is `False`. Otherwise unchanged.
- `list(self, include_deleted=False, **filters)`: same exclusion rule as
  `get`, applied before the existing `**filters` matching. Existing
  filter behaviour (`list(status="pending")` etc.) is unchanged other
  than this new exclusion.
- `remove(self, id)`: **becomes a soft delete.** Sets `item.deleted_at =
  self._clock()` (the injected clock's current value — this is the
  "clock injection point") and returns the item, or `None` if `id` is
  not present at all. Calling `remove` again on an already soft-deleted
  row simply overwrites `deleted_at` with the clock's current value; it
  does not raise and does not check the row's current state. This is a
  breaking change to `remove`'s return type (item-or-`None` instead of
  `True`/`False`) and to its effect (soft instead of hard delete) —
  that's the point of the ticket.
- `purge(self, id)`: **new method.** Hard-deletes regardless of
  `deleted_at`: `return self._items.pop(id, None)`.
- `add`, `update`, `count` are **unchanged**. In particular `update(id,
  **changes)` keeps looking the row up directly (not through `get`), so
  it still succeeds on a soft-deleted row — do not add a deleted check
  to it.

## 3. `delete`/`restore` on `ProductService`, `OrderService`,
`CustomerService` only

Add two methods to each of these three services (`invsys/services/
product_service.py`, `order_service.py`, `customer_service.py`) — not to
`WarehouseService`, `SupplierService`, `ShipmentService`,
`InvoiceService` or `StockService`, which are out of scope for this
ticket:

```python
def delete(self, id):
    item = self.repo.get(id, include_deleted=True)
    if item is None:
        raise NotFoundError(f"{kind} {id} not found")
    return self.repo.remove(id)

def restore(self, id):
    item = self.repo.get(id, include_deleted=True)
    if item is None:
        raise NotFoundError(f"{kind} {id} not found")
    item.deleted_at = None
    return item
```

`{kind}` is `"product"` / `"order"` / `"customer"` respectively, matching
the message format the existing `get_product`/`get_order`/`get_customer`
methods already use. Both methods look the row up **with
`include_deleted=True`**, so `NotFoundError` is raised only when the id
never existed at all — never for a row that is merely already deleted
(deleting an already-deleted row is a no-op that still succeeds and
returns the item; restoring a not-currently-deleted row is a no-op that
still succeeds and returns the item with `deleted_at` already `None`).

Also change these three services' `list_x(self, **filters)` to
`list_x(self, include_deleted=False, **filters)`, forwarding
`include_deleted` to `self.repo.list(include_deleted=include_deleted,
**filters)`. `get_x`/`update_x`/`create_x` are unchanged (they still go
through `self.repo.get`/`self.repo.update` with the default
`include_deleted=False`, so, for example, `get_product` on a
soft-deleted id still raises `NotFoundError` exactly as it does today
for a missing id).

## 4. API: 404 on deleted read, `{"deleted_at": ...}` on delete, new
`restore` action — `product_handlers.py`, `order_handlers.py`,
`customer_handlers.py` only

- The `get` action needs **no code change**: it already goes through
  `service.get_x`, which now raises `NotFoundError` for a soft-deleted
  row via the `BaseRepo.get` change above, and the handler already turns
  `NotFoundError` into `404`.
- The `delete` action currently calls `service.repo.remove(request["id"])`
  directly (bound to the old bool-returning hard delete) and returns
  `(200, {"status": "deleted"})` or `(404, ...)`. Change it to call the
  new `service.delete(request["id"])`, catching `NotFoundError` for
  `404`, and on success return exactly `(200, {"deleted_at":
  item.deleted_at})` — that one key, not the full item.
- Add a new `restore` action:
  ```python
  def handle_<name>_restore(service, request):
      try:
          item = service.restore(request["id"])
      except NotFoundError as exc:
          return 404, {"error": str(exc)}
      return 200, item.to_dict()
  ```
  and register it as `"restore": handle_<name>_restore` in that module's
  `ACTIONS` dict (`product_handlers.ACTIONS`, `order_handlers.ACTIONS`,
  `customer_handlers.ACTIONS`). `invsys/api/router.py` needs no change —
  it already dispatches through each module's `ACTIONS` dict by lookup.
  `warehouse_handlers.py`, `shipment_handlers.py` and `stock_handlers.py`
  are unaffected: no `delete`/`restore` action for those resources.

## 5. CLI `--include-deleted` — `product_commands.py`,
`order_commands.py` (its `order-list` subcommand only, not
`shipment-list`/`invoice-list`), `customer_commands.py` only

Each of `product-list`, `order-list`, `customer-list` gains a
`--include-deleted` boolean flag (`action="store_true"`, default
`False`), forwarded as `include_deleted=args.include_deleted` into the
corresponding `list_x` service call. `shipment-list`, `invoice-list` and
`partner_commands.py`'s `warehouse-list`/`supplier-list` are unchanged
(no flag, no `include_deleted` support — those services were not given
`delete`/`restore` in step 3).

## 6. `reporting.py` excludes deleted rows

`ReportingService` currently reads repos through their raw
`._items.values()` (bypassing any filtering) instead of `.list()`.
Change every such access to `.list()` (its default `include_deleted=False`
excludes soft-deleted rows) in all three methods:

- `inventory_summary`: build the `products` lookup from
  `self._products.list()` and iterate `self._stock.list()` instead of
  the two repos' `._items.values()`.
- `order_status_breakdown`: iterate `self._orders.list()`.
- `top_customers`: iterate `self._orders.list()`.

This excludes soft-deleted products, stock rows and orders from every
aggregate. (It does not additionally cross-reference a customer's own
`deleted_at` against that customer's orders in `top_customers` — a
deleted customer's still-undeleted orders still count. That's out of
scope.)

## Summary of files to change

`invsys/models/base.py`, `invsys/repos/base.py`,
`invsys/services/product_service.py`,
`invsys/services/order_service.py`,
`invsys/services/customer_service.py`,
`invsys/services/reporting.py`,
`invsys/api/product_handlers.py`, `invsys/api/order_handlers.py`,
`invsys/api/customer_handlers.py`,
`invsys/cli/product_commands.py`, `invsys/cli/order_commands.py`,
`invsys/cli/customer_commands.py`.

Nothing else should need to change. `python3 -m pytest -q tests` must
keep passing throughout.
