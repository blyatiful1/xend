#!/usr/bin/env bash
# Reference solution for project-brownfield-softdelete: implements the
# change described in fixture/TASK.md by rewriting the 12 files it names.
# Run from a directory that already has invsys/ (i.e. after gen.sh).
set -eu

python3 - <<'PYEOF'
import os


def w(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text.lstrip("\n").rstrip() + "\n")


assert os.path.isdir("invsys"), "run this from a directory containing invsys/ (after gen.sh)"

w("invsys/models/base.py", '''
"""Shared dataclass base for every invsys entity model.

to_dict/from_dict work generically from the dataclass's field list, so
individual models do not hand-write serialization.
"""

import dataclasses
from typing import Any, Dict, Optional


@dataclasses.dataclass
class BaseModel:
    """Base class for all invsys entity dataclasses. `deleted_at` is
    kw_only so it can carry a default without breaking subclasses that
    declare required fields of their own (dataclass field-ordering rules
    only apply to non-kw_only fields)."""

    deleted_at: Optional[str] = dataclasses.field(default=None, kw_only=True)

    def to_dict(self) -> Dict[str, Any]:
        """Return every dataclass field as a plain dict, in field order."""
        return {f.name: getattr(self, f.name) for f in dataclasses.fields(self)}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]):
        """Build an instance from a dict, ignoring unknown keys."""
        field_names = {f.name for f in dataclasses.fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in field_names})
''')

w("invsys/repos/base.py", '''
"""In-memory repository base class shared by every entity repository."""

from invsys.utils.clock import now_iso


class BaseRepo:
    """A simple in-memory CRUD store keyed by ``item.id``, with soft
    delete: `remove` marks a row instead of dropping it, and `get`/`list`
    exclude soft-deleted rows unless include_deleted=True."""

    def __init__(self, clock=None):
        self._items = {}
        self._clock = clock or now_iso

    def add(self, item):
        """Insert `item` (keyed by item.id), overwriting any existing row
        with the same id, and return it."""
        self._items[item.id] = item
        return item

    def get(self, id, include_deleted=False):
        """Return the item with this id, or None if not present, or if
        it is soft-deleted and include_deleted is False."""
        item = self._items.get(id)
        if item is None:
            return None
        if item.deleted_at is not None and not include_deleted:
            return None
        return item

    def list(self, include_deleted=False, **filters):
        """Return every matching, non-deleted item (exact-equality
        filters), in insertion order; soft-deleted rows are included only
        if include_deleted is True."""
        return [i for i in self._items.values()
                if (include_deleted or i.deleted_at is None)
                and all(getattr(i, k, None) == v for k, v in filters.items())]

    def update(self, id, **changes):
        """Apply `changes` as attribute assignments and return the item,
        or None if id is not present. Unaffected by deleted_at."""
        item = self._items.get(id)
        if item is None:
            return None
        for k, v in changes.items():
            setattr(item, k, v)
        return item

    def remove(self, id):
        """Soft-delete: set `deleted_at` to the injected clock's current
        value and return the item, or None if id is not present. Safe to
        call again on an already soft-deleted row (just refreshes the
        timestamp)."""
        item = self._items.get(id)
        if item is None:
            return None
        item.deleted_at = self._clock()
        return item

    def purge(self, id):
        """Hard delete: remove the row entirely, regardless of
        deleted_at. Returns the removed item, or None if id was absent."""
        return self._items.pop(id, None)

    def count(self):
        """Return the number of rows currently stored."""
        return len(self._items)
''')


# Product/Order/Customer services: add delete/restore, and include_deleted
# on list_x. Written out in full (not a diff) for robustness.

w("invsys/services/product_service.py", '''
"""Business logic for products."""

from invsys.errors import NotFoundError
from invsys.models.product import Product
from invsys.utils.ids import IdGenerator

class ProductService:
    """Wraps a ProductRepo with id assignment and CRUD lookups."""

    def __init__(self, product_repo):
        self.repo = product_repo
        self._ids = IdGenerator("PRD")

    def create_product(self, sku, name, category, unit_price, reorder_threshold, active=True, id=None):
        product = Product(id=id or self._ids.next(), sku=sku, name=name, category=category, unit_price=unit_price, reorder_threshold=reorder_threshold, active=active)
        return self.repo.add(product)

    def get_product(self, id):
        product = self.repo.get(id)
        if product is None:
            raise NotFoundError(f"product {id} not found")
        return product

    def list_products(self, include_deleted=False, **filters):
        return self.repo.list(include_deleted=include_deleted, **filters)

    def update_product(self, id, **changes):
        product = self.repo.update(id, **changes)
        if product is None:
            raise NotFoundError(f"product {id} not found")
        return product

    def delete(self, id):
        item = self.repo.get(id, include_deleted=True)
        if item is None:
            raise NotFoundError(f"product {id} not found")
        return self.repo.remove(id)

    def restore(self, id):
        item = self.repo.get(id, include_deleted=True)
        if item is None:
            raise NotFoundError(f"product {id} not found")
        item.deleted_at = None
        return item
''')

w("invsys/services/order_service.py", '''
"""Business logic for orders."""

from invsys.errors import NotFoundError
from invsys.models.order import Order
from invsys.utils.ids import IdGenerator
from invsys.utils.clock import now_iso

class OrderService:
    """Wraps a OrderRepo with id assignment and CRUD lookups."""

    def __init__(self, order_repo, customer_repo, warehouse_repo, product_repo, clock=None):
        self.repo = order_repo
        self._customers = customer_repo
        self._warehouses = warehouse_repo
        self._products = product_repo
        self._ids = IdGenerator("ORD")
        self._clock = clock or now_iso

    def place_order(self, customer_id, warehouse_id, product_id, quantity, id=None):
        if self._customers.get(customer_id) is None:
            raise NotFoundError(f"customer {customer_id} not found")
        if self._warehouses.get(warehouse_id) is None:
            raise NotFoundError(f"warehouse {warehouse_id} not found")
        if self._products.get(product_id) is None:
            raise NotFoundError(f"product {product_id} not found")
        order = Order(id=id or self._ids.next(), customer_id=customer_id, warehouse_id=warehouse_id, product_id=product_id, quantity=quantity, status="pending", created_at=self._clock())
        return self.repo.add(order)

    def get_order(self, id):
        order = self.repo.get(id)
        if order is None:
            raise NotFoundError(f"order {id} not found")
        return order

    def list_orders(self, include_deleted=False, **filters):
        return self.repo.list(include_deleted=include_deleted, **filters)

    def update_order(self, id, **changes):
        order = self.repo.update(id, **changes)
        if order is None:
            raise NotFoundError(f"order {id} not found")
        return order

    def delete(self, id):
        item = self.repo.get(id, include_deleted=True)
        if item is None:
            raise NotFoundError(f"order {id} not found")
        return self.repo.remove(id)

    def restore(self, id):
        item = self.repo.get(id, include_deleted=True)
        if item is None:
            raise NotFoundError(f"order {id} not found")
        item.deleted_at = None
        return item
''')

w("invsys/services/customer_service.py", '''
"""Business logic for customers."""

from invsys.errors import NotFoundError
from invsys.models.customer import Customer
from invsys.utils.ids import IdGenerator

class CustomerService:
    """Wraps a CustomerRepo with id assignment and CRUD lookups."""

    def __init__(self, customer_repo):
        self.repo = customer_repo
        self._ids = IdGenerator("CUS")

    def create_customer(self, name, email, tier, credit_limit, active=True, id=None):
        customer = Customer(id=id or self._ids.next(), name=name, email=email, tier=tier, credit_limit=credit_limit, active=active)
        return self.repo.add(customer)

    def get_customer(self, id):
        customer = self.repo.get(id)
        if customer is None:
            raise NotFoundError(f"customer {id} not found")
        return customer

    def list_customers(self, include_deleted=False, **filters):
        return self.repo.list(include_deleted=include_deleted, **filters)

    def update_customer(self, id, **changes):
        customer = self.repo.update(id, **changes)
        if customer is None:
            raise NotFoundError(f"customer {id} not found")
        return customer

    def delete(self, id):
        item = self.repo.get(id, include_deleted=True)
        if item is None:
            raise NotFoundError(f"customer {id} not found")
        return self.repo.remove(id)

    def restore(self, id):
        item = self.repo.get(id, include_deleted=True)
        if item is None:
            raise NotFoundError(f"customer {id} not found")
        item.deleted_at = None
        return item
''')

w("invsys/services/reporting.py", '''
"""Cross-entity, read-only reporting: aggregates over several repos."""


class ReportingService:
    """Builds summaries across products, orders, customers and stock."""

    def __init__(self, product_repo, order_repo, customer_repo, stock_repo):
        self._products = product_repo
        self._orders = order_repo
        self._customers = customer_repo
        self._stock = stock_repo

    def inventory_summary(self):
        """{"active_products", "total_on_hand", "low_stock_product_ids"}."""
        products = {p.id: p for p in self._products.list()}
        active_products = sum(1 for p in products.values() if p.active)
        total_on_hand = 0
        low_stock = []
        for level in self._stock.list():
            total_on_hand += level.quantity
            product = products.get(level.product_id)
            if product is not None and level.quantity - level.reserved < product.reorder_threshold:
                low_stock.append(level.product_id)
        return {
            "active_products": active_products,
            "total_on_hand": total_on_hand,
            "low_stock_product_ids": sorted(set(low_stock)),
        }

    def order_status_breakdown(self):
        """Return status -> count over every order."""
        counts = {}
        for order in self._orders.list():
            counts[order.status] = counts.get(order.status, 0) + 1
        return counts

    def top_customers(self, n):
        """Return the `n` customers with the most orders, as
        (customer_id, count), sorted by count desc, id asc."""
        counts = {}
        for order in self._orders.list():
            counts[order.customer_id] = counts.get(order.customer_id, 0) + 1
        return sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))[:n]
''')

w("invsys/api/product_handlers.py", '''
"""Handlers for the product resource."""

from invsys.errors import NotFoundError, ValidationError


def handle_product_get(service, request):
    try:
        item = service.get_product(request["id"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    return 200, item.to_dict()

def handle_product_list(service, request):
    items = service.list_products(**request.get("filters", {}))
    return 200, {"items": [i.to_dict() for i in items]}

def handle_product_create(service, request):
    try:
        item = service.create_product(**request["data"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    except ValidationError as exc:
        return 400, {"error": str(exc)}
    return 201, item.to_dict()

def handle_product_update(service, request):
    try:
        item = service.update_product(request["id"], **request.get("changes", {}))
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    except ValidationError as exc:
        return 400, {"error": str(exc)}
    return 200, item.to_dict()

def handle_product_delete(service, request):
    try:
        item = service.delete(request["id"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    return 200, {"deleted_at": item.deleted_at}

def handle_product_restore(service, request):
    try:
        item = service.restore(request["id"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    return 200, item.to_dict()

ACTIONS = {
    "get": handle_product_get,
    "list": handle_product_list,
    "create": handle_product_create,
    "update": handle_product_update,
    "delete": handle_product_delete,
    "restore": handle_product_restore,
}
''')

w("invsys/api/order_handlers.py", '''
"""Handlers for the order resource."""

from invsys.errors import NotFoundError, ValidationError


def handle_order_get(service, request):
    try:
        item = service.get_order(request["id"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    return 200, item.to_dict()

def handle_order_list(service, request):
    items = service.list_orders(**request.get("filters", {}))
    return 200, {"items": [i.to_dict() for i in items]}

def handle_order_create(service, request):
    try:
        item = service.place_order(**request["data"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    except ValidationError as exc:
        return 400, {"error": str(exc)}
    return 201, item.to_dict()

def handle_order_update(service, request):
    try:
        item = service.update_order(request["id"], **request.get("changes", {}))
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    except ValidationError as exc:
        return 400, {"error": str(exc)}
    return 200, item.to_dict()

def handle_order_delete(service, request):
    try:
        item = service.delete(request["id"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    return 200, {"deleted_at": item.deleted_at}

def handle_order_restore(service, request):
    try:
        item = service.restore(request["id"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    return 200, item.to_dict()

ACTIONS = {
    "get": handle_order_get,
    "list": handle_order_list,
    "create": handle_order_create,
    "update": handle_order_update,
    "delete": handle_order_delete,
    "restore": handle_order_restore,
}
''')

w("invsys/api/customer_handlers.py", '''
"""Handlers for the customer resource."""

from invsys.errors import NotFoundError, ValidationError


def handle_customer_get(service, request):
    try:
        item = service.get_customer(request["id"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    return 200, item.to_dict()

def handle_customer_list(service, request):
    items = service.list_customers(**request.get("filters", {}))
    return 200, {"items": [i.to_dict() for i in items]}

def handle_customer_create(service, request):
    try:
        item = service.create_customer(**request["data"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    except ValidationError as exc:
        return 400, {"error": str(exc)}
    return 201, item.to_dict()

def handle_customer_update(service, request):
    try:
        item = service.update_customer(request["id"], **request.get("changes", {}))
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    except ValidationError as exc:
        return 400, {"error": str(exc)}
    return 200, item.to_dict()

def handle_customer_delete(service, request):
    try:
        item = service.delete(request["id"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    return 200, {"deleted_at": item.deleted_at}

def handle_customer_restore(service, request):
    try:
        item = service.restore(request["id"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    return 200, item.to_dict()

ACTIONS = {
    "get": handle_customer_get,
    "list": handle_customer_list,
    "create": handle_customer_create,
    "update": handle_customer_update,
    "delete": handle_customer_delete,
    "restore": handle_customer_restore,
}
''')

w("invsys/cli/product_commands.py", '''
"""Product-related commands."""


def cmd_product_list(args, ctx):
    """Print every product, one dict per line."""
    for item in ctx["product_service"].list_products(include_deleted=args.include_deleted):
        print(item.to_dict())
    return 0

def register(sub):
    p = sub.add_parser("product-list")
    p.add_argument("--include-deleted", action="store_true")
    p.set_defaults(func=cmd_product_list)
''')

w("invsys/cli/order_commands.py", '''
"""Order-fulfillment commands: orders, shipments, invoices."""


def cmd_order_list(args, ctx):
    """Print every order, one dict per line."""
    for item in ctx["order_service"].list_orders(include_deleted=args.include_deleted):
        print(item.to_dict())
    return 0

def cmd_shipment_list(args, ctx):
    """Print every shipment, one dict per line."""
    for item in ctx["shipment_service"].list_shipments():
        print(item.to_dict())
    return 0

def cmd_invoice_list(args, ctx):
    """Print every invoice, one dict per line."""
    for item in ctx["invoice_service"].list_invoices():
        print(item.to_dict())
    return 0

def register(sub):
    p = sub.add_parser("order-list")
    p.add_argument("--include-deleted", action="store_true")
    p.set_defaults(func=cmd_order_list)
    sub.add_parser("shipment-list").set_defaults(func=cmd_shipment_list)
    sub.add_parser("invoice-list").set_defaults(func=cmd_invoice_list)
''')

w("invsys/cli/customer_commands.py", '''
"""Customer-related commands."""


def cmd_customer_list(args, ctx):
    """Print every customer, one dict per line."""
    for item in ctx["customer_service"].list_customers(include_deleted=args.include_deleted):
        print(item.to_dict())
    return 0

def register(sub):
    p = sub.add_parser("customer-list")
    p.add_argument("--include-deleted", action="store_true")
    p.set_defaults(func=cmd_customer_list)
''')

print("applied soft-delete change to 12 files")
PYEOF
