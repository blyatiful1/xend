#!/usr/bin/env bash
set -eu
python3 - <<'PYEOF'
import os

ENTITIES = [
    dict(name="product", plural="products", cls="Product", prefix="PRD",
         fields=[("sku", "str", None), ("name", "str", None),
                 ("category", "str", None), ("unit_price", "float", None),
                 ("reorder_threshold", "int", None), ("active", "bool", "True")],
         validations=["require_non_empty(self.sku, \"sku\")",
                      "require_non_empty(self.name, \"name\")",
                      "require_non_empty(self.category, \"category\")",
                      "require_non_negative(self.unit_price, \"unit_price\")",
                      "require_non_negative(self.reorder_threshold, \"reorder_threshold\")"],
         finder=("find_by_sku", "sku", "one")),
    dict(name="warehouse", plural="warehouses", cls="Warehouse", prefix="WHS",
         fields=[("code", "str", None), ("name", "str", None),
                 ("region", "str", None), ("capacity", "int", None), ("active", "bool", "True")],
         validations=["require_non_empty(self.code, \"code\")",
                      "require_non_empty(self.name, \"name\")",
                      "require_non_empty(self.region, \"region\")",
                      "require_positive(self.capacity, \"capacity\")"],
         finder=("find_by_code", "code", "one")),
    dict(name="supplier", plural="suppliers", cls="Supplier", prefix="SUP",
         fields=[("name", "str", None), ("contact_email", "str", None),
                 ("region", "str", None), ("rating", "int", None), ("active", "bool", "True")],
         validations=["require_non_empty(self.name, \"name\")",
                      "require_contains(self.contact_email, \"@\", \"contact_email\")",
                      "require_range(self.rating, 1, 5, \"rating\")"],
         finder=("find_by_region", "region", "many")),
    dict(name="customer", plural="customers", cls="Customer", prefix="CUS",
         fields=[("name", "str", None), ("email", "str", None),
                 ("tier", "str", None), ("credit_limit", "float", None), ("active", "bool", "True")],
         validations=["require_non_empty(self.name, \"name\")",
                      "require_contains(self.email, \"@\", \"email\")",
                      "require_one_of(self.tier, (\"standard\", \"premium\", \"vip\"), \"tier\")",
                      "require_non_negative(self.credit_limit, \"credit_limit\")"],
         finder=("find_by_email", "email", "one")),
    dict(name="order", plural="orders", cls="Order", prefix="ORD",
         fields=[("customer_id", "str", None), ("warehouse_id", "str", None),
                 ("product_id", "str", None), ("quantity", "int", None), ("status", "str", None),
                 ("created_at", "str", None)],
         validations=["require_positive(self.quantity, \"quantity\")",
                      "require_one_of(self.status, ORDER_STATUSES, \"status\")"],
         finder=("list_by_customer", "customer_id", "many"),
         extra_repos=[("customer_repo", "_customers", "customer"),
                      ("warehouse_repo", "_warehouses", "warehouse"),
                      ("product_repo", "_products", "product")],
         fk_checks=[("_customers", "customer_id", "customer"),
                    ("_warehouses", "warehouse_id", "warehouse"),
                    ("_products", "product_id", "product")],
         auto_fields={"status": '"pending"', "created_at": "self._clock()"},
         needs_clock=True, create_method="place_order"),
    dict(name="shipment", plural="shipments", cls="Shipment", prefix="SHP",
         fields=[("order_id", "str", None), ("warehouse_id", "str", None),
                 ("carrier", "str", None), ("tracking_code", "str", None), ("status", "str", None)],
         validations=["require_non_empty(self.carrier, \"carrier\")",
                      "require_non_empty(self.tracking_code, \"tracking_code\")",
                      "require_one_of(self.status, SHIPMENT_STATUSES, \"status\")"],
         finder=("list_by_order", "order_id", "many"),
         extra_repos=[("order_repo", "_orders", "order")],
         fk_checks=[("_orders", "order_id", "order")],
         auto_fields={"status": '"pending"'}),
    dict(name="invoice", plural="invoices", cls="Invoice", prefix="INV",
         fields=[("order_id", "str", None), ("customer_id", "str", None),
                 ("amount", "float", None), ("status", "str", None)],
         validations=["require_non_negative(self.amount, \"amount\")",
                      "require_one_of(self.status, INVOICE_STATUSES, \"status\")"],
         finder=("list_by_order", "order_id", "many"),
         extra_repos=[("order_repo", "_orders", "order"),
                      ("customer_repo", "_customers", "customer")],
         fk_checks=[("_orders", "order_id", "order"),
                    ("_customers", "customer_id", "customer")],
         auto_fields={"status": '"unpaid"'}),
    dict(name="stock_level", plural="stock_levels", cls="StockLevel", prefix="STK",
         fields=[("product_id", "str", None), ("warehouse_id", "str", None),
                 ("quantity", "int", None), ("reserved", "int", None)],
         validations=["require_non_negative(self.quantity, \"quantity\")",
                      "require_non_negative(self.reserved, \"reserved\")"],
         finder=("find_by_product_warehouse", "product_id, warehouse_id", "one")),
]

BY_NAME = {e["name"]: e for e in ENTITIES}

STATUS_CONSTS = {
    "order": ("ORDER_STATUSES", '("pending", "confirmed", "shipped", "cancelled")'),
    "shipment": ("SHIPMENT_STATUSES", '("pending", "in_transit", "delivered", "returned")'),
    "invoice": ("INVOICE_STATUSES", '("unpaid", "paid", "void")'),
}

def w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text.rstrip() + "\n")

def field_sig(fields):
    fields = [("id", "str", None)] + fields
    req = [f"    {n}: {t}" for n, t, d in fields if d is None]
    opt = [f"    {n}: {t} = {d}" for n, t, d in fields if d is not None]
    return "\n".join(req + opt)

w("invsys/__init__.py", '"""invsys: a small in-memory inventory management system.\n\nLayers: models -> repos -> services -> api / cli. Each layer only\ndepends on the ones below it.\n"""\n\n__version__ = "1.0.0"\n')

w("invsys/errors.py", '''"""Exception types shared across every layer of invsys."""

class InvsysError(Exception):
    """Base class for every invsys-specific exception."""

class ValidationError(InvsysError):
    """Raised when a model's fields fail validation."""

class NotFoundError(InvsysError):
    """Raised when a requested id does not exist."""

class ConflictError(InvsysError):
    """Raised when an operation would violate a business rule."""
''')

w("invsys/utils/__init__.py", '"""Small stand-alone helpers shared across invsys layers."""\n')

w("invsys/utils/ids.py", '''"""Deterministic id generation (no randomness, no wall-clock dependence)."""

class IdGenerator:
    """Produces ids like "PRD-000001", "PRD-000002", ... in call order."""

    def __init__(self, prefix, width=6, start=1):
        self._prefix = prefix
        self._width = width
        self._next = start

    def next(self):
        """Return the next id and advance the counter."""
        value = self.peek()
        self._next += 1
        return value

    def peek(self):
        """Return the id the next call to next() will produce."""
        return f"{self._prefix}-{self._next:0{self._width}d}"
''')

w("invsys/utils/clock.py", '''"""Injectable UTC clock: pass `clock` (a zero-arg callable returning an
ISO-8601 string) wherever a timestamp is needed, instead of calling
datetime.now directly, so tests can substitute a deterministic clock."""

from datetime import datetime, timezone

def now_iso():
    """Return the current time as an ISO-8601 string in UTC."""
    return datetime.now(timezone.utc).isoformat()

def fixed_clock(iso_string):
    """Return a zero-arg callable that always returns `iso_string`."""

    def _clock():
        return iso_string

    return _clock
''')

w("invsys/utils/validation.py", '''"""Validators shared by every model's __post_init__; each raises
invsys.errors.ValidationError on failure."""

from numbers import Number

from invsys.errors import ValidationError

def require_non_empty(value, field_name):
    if not isinstance(value, str) or not value.strip():
        raise ValidationError(f"{field_name} must not be empty")

def require_non_negative(value, field_name):
    if isinstance(value, bool) or not isinstance(value, Number) or value < 0:
        raise ValidationError(f"{field_name} must be >= 0")

def require_positive(value, field_name):
    if isinstance(value, bool) or not isinstance(value, Number) or value <= 0:
        raise ValidationError(f"{field_name} must be > 0")

def require_range(value, low, high, field_name):
    if isinstance(value, bool) or not isinstance(value, Number) or not (low <= value <= high):
        raise ValidationError(f"{field_name} must be between {low} and {high}")

def require_one_of(value, allowed, field_name):
    if value not in allowed:
        raise ValidationError(f"{field_name} must be one of {sorted(allowed)}, got {value!r}")

def require_contains(value, substring, field_name):
    if not isinstance(value, str) or substring not in value:
        raise ValidationError(f"{field_name} must contain {substring!r}")
''')

w("invsys/models/__init__.py", '"""Entity dataclasses: the data shapes shared by every other layer."""\n')

w("invsys/models/base.py", '''"""Shared dataclass base for every invsys entity model.

to_dict/from_dict work generically from the dataclass's field list, so
individual models do not hand-write serialization.
"""

import dataclasses
from typing import Any, Dict

@dataclasses.dataclass
class BaseModel:
    """Base class for all invsys entity dataclasses."""

    def to_dict(self) -> Dict[str, Any]:
        """Return every dataclass field as a plain dict, in field order."""
        return {f.name: getattr(self, f.name) for f in dataclasses.fields(self)}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]):
        """Build an instance from a dict, ignoring unknown keys."""
        field_names = {f.name for f in dataclasses.fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in field_names})
''')

for e in ENTITIES:
    name, cls, fields = e["name"], e["cls"], e["fields"]
    const_line = ""
    if name in STATUS_CONSTS:
        cname, cval = STATUS_CONSTS[name]
        const_line = f"\n{cname} = {cval}\n"
    validations = "\n".join(f"        {v}" for v in e["validations"])
    w(f"invsys/models/{name}.py", f'''"""The {cls} model."""

from dataclasses import dataclass

from invsys.models.base import BaseModel
from invsys.utils.validation import (
    require_contains,
    require_non_empty,
    require_non_negative,
    require_one_of,
    require_positive,
    require_range,
)
{const_line}

@dataclass
class {cls}(BaseModel):
{field_sig(fields)}

    def __post_init__(self):
{validations}
''')

w("invsys/repos/__init__.py", '"""In-memory repositories: one CRUD store per entity, all sharing BaseRepo."""\n')

w("invsys/repos/base.py", '''"""In-memory repository base class shared by every entity repository."""

class BaseRepo:
    """A simple in-memory CRUD store keyed by ``item.id``."""

    def __init__(self):
        self._items = {}

    def add(self, item):
        """Insert `item` (keyed by item.id), overwriting any existing row
        with the same id, and return it."""
        self._items[item.id] = item
        return item

    def get(self, id):
        """Return the item with this id, or None if not present."""
        return self._items.get(id)

    def list(self, **filters):
        """Return every item matching all of `filters` (exact equality),
        in insertion order."""
        return [i for i in self._items.values()
                if all(getattr(i, k, None) == v for k, v in filters.items())]

    def update(self, id, **changes):
        """Apply `changes` as attribute assignments and return the item,
        or None if id is not present."""
        item = self._items.get(id)
        if item is None:
            return None
        for k, v in changes.items():
            setattr(item, k, v)
        return item

    def remove(self, id):
        """Delete the item with this id. Returns True if removed, False
        if id was not present."""
        if id in self._items:
            del self._items[id]
            return True
        return False

    def count(self):
        """Return the number of rows currently stored."""
        return len(self._items)
''')

for e in ENTITIES:
    name, cls = e["name"], e["cls"]
    fname, fparam, arity = e["finder"]
    kwargs = ", ".join(f"{p.strip()}={p.strip()}" for p in fparam.split(","))
    if arity == "one":
        body = (f'    def {fname}(self, {fparam}):\n'
                f'        """Return the item with this {fparam}, or None."""\n'
                f'        matches = self.list({kwargs})\n'
                f'        return matches[0] if matches else None\n')
    else:
        body = (f'    def {fname}(self, {fparam}):\n'
                f'        """Return every item for this {fparam}, in insertion order."""\n'
                f'        return self.list({kwargs})\n')
    w(f"invsys/repos/{name}_repo.py", f'''"""In-memory repository for {cls}."""

from invsys.repos.base import BaseRepo

class {cls}Repo(BaseRepo):
    """CRUD storage for {cls} rows, plus one convenience finder."""

{body}''')

# invsys/services/*.py

w("invsys/services/__init__.py", '"""Business logic: one service per entity, plus cross-entity reporting."""\n')

def crud_block(name, plural):
    return f'''    def get_{name}(self, id):
        {name} = self.repo.get(id)
        if {name} is None:
            raise NotFoundError(f"{name} {{id}} not found")
        return {name}

    def list_{plural}(self, **filters):
        return self.repo.list(**filters)

    def update_{name}(self, id, **changes):
        {name} = self.repo.update(id, **changes)
        if {name} is None:
            raise NotFoundError(f"{name} {{id}} not found")
        return {name}
'''

def gen_service(e):
    name, cls, plural, prefix = e["name"], e["cls"], e["plural"], e["prefix"]
    extra_repos = e.get("extra_repos", [])
    fk_checks = e.get("fk_checks", [])
    auto_fields = e.get("auto_fields", {})
    needs_clock = e.get("needs_clock", False)
    create_method = e.get("create_method", f"create_{name}")

    user_fields = [f for f in e["fields"] if f[0] != "id" and f[0] not in auto_fields]
    create_sig = ", ".join(n if d is None else f"{n}={d}" for n, t, d in user_fields)
    kwargs = [f"{n}={n}" for n, t, d in user_fields] + [f"{n}={v}" for n, v in auto_fields.items()]

    ctor_params = ", ".join([f"{name}_repo"] + [p for p, a, k in extra_repos] + (["clock=None"] if needs_clock else []))
    ctor_body = "\n".join(
        [f"        self.repo = {name}_repo"]
        + [f"        self.{a} = {p}" for p, a, k in extra_repos]
        + [f'        self._ids = IdGenerator("{prefix}")']
        + (["        self._clock = clock or now_iso"] if needs_clock else [])
    )
    checks = "".join(
        f'        if self.{attr}.get({field}) is None:\n'
        f'            raise NotFoundError(f"{kind} {{{field}}} not found")\n'
        for attr, field, kind in fk_checks
    )
    imports = [
        "from invsys.errors import NotFoundError",
        f"from invsys.models.{name} import {cls}",
        "from invsys.utils.ids import IdGenerator",
    ]
    if needs_clock:
        imports.append("from invsys.utils.clock import now_iso")

    return f'''"""Business logic for {plural}."""

{chr(10).join(imports)}

class {cls}Service:
    """Wraps a {cls}Repo with id assignment and CRUD lookups."""

    def __init__(self, {ctor_params}):
{ctor_body}

    def {create_method}(self, {create_sig}, id=None):
{checks}        {name} = {cls}(id=id or self._ids.next(), {", ".join(kwargs)})
        return self.repo.add({name})

{crud_block(name, plural)}'''

for e in ENTITIES:
    if e["name"] == "stock_level":
        continue
    w(f"invsys/services/{e['name']}_service.py", gen_service(e))

w("invsys/services/stock_service.py", '''"""Business logic for stock levels (keyed by product+warehouse, not a
single id, so this does not fit the generic CRUD shape)."""

from invsys.errors import ConflictError, NotFoundError
from invsys.models.stock_level import StockLevel
from invsys.utils.ids import IdGenerator

class StockService:
    """Creates StockLevel rows and reserves quantity against them."""

    def __init__(self, stock_repo, product_repo):
        self.repo = stock_repo
        self._products = product_repo
        self._ids = IdGenerator("STK")

    def create_level(self, product_id, warehouse_id, quantity, reserved=0, id=None):
        if self._products.get(product_id) is None:
            raise NotFoundError(f"product {product_id} not found")
        level = StockLevel(
            id=id or self._ids.next(), product_id=product_id, warehouse_id=warehouse_id,
            quantity=quantity, reserved=reserved,
        )
        return self.repo.add(level)

    def get_level(self, product_id, warehouse_id):
        level = self.repo.find_by_product_warehouse(product_id, warehouse_id)
        if level is None:
            raise NotFoundError(f"no stock level for {product_id} at {warehouse_id}")
        return level

    def list_levels(self, **filters):
        return self.repo.list(**filters)

    def reserve(self, product_id, warehouse_id, quantity):
        """Reserve `quantity` units; ConflictError if not enough are free."""
        level = self.get_level(product_id, warehouse_id)
        available = level.quantity - level.reserved
        if quantity > available:
            raise ConflictError(
                f"cannot reserve {quantity} units of {product_id} at {warehouse_id}: "
                f"only {available} available"
            )
        level.reserved += quantity
        return level
''')

w("invsys/services/reporting.py", '''"""Cross-entity, read-only reporting: aggregates over several repos."""

class ReportingService:
    """Builds summaries across products, orders, customers and stock."""

    def __init__(self, product_repo, order_repo, customer_repo, stock_repo):
        self._products = product_repo
        self._orders = order_repo
        self._customers = customer_repo
        self._stock = stock_repo

    def inventory_summary(self):
        """{"active_products", "total_on_hand", "low_stock_product_ids"}."""
        products = {p.id: p for p in self._products._items.values()}
        active_products = sum(1 for p in products.values() if p.active)
        total_on_hand = 0
        low_stock = []
        for level in self._stock._items.values():
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
        for order in self._orders._items.values():
            counts[order.status] = counts.get(order.status, 0) + 1
        return counts

    def top_customers(self, n):
        """Return the `n` customers with the most orders, as
        (customer_id, count), sorted by count desc, id asc."""
        counts = {}
        for order in self._orders._items.values():
            counts[order.customer_id] = counts.get(order.customer_id, 0) + 1
        return sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))[:n]
''')

# invsys/api/*.py

w("invsys/api/__init__.py", '"""Request-dict-in, (status, body)-tuple-out handlers, dispatched by router.py."""\n')

def api_crud(prefix, get_call, list_call, create_call, update_call):
    return f'''def handle_{prefix}_get(service, request):
    try:
        item = {get_call}
    except NotFoundError as exc:
        return 404, {{"error": str(exc)}}
    return 200, item.to_dict()

def handle_{prefix}_list(service, request):
    items = {list_call}
    return 200, {{"items": [i.to_dict() for i in items]}}

def handle_{prefix}_create(service, request):
    try:
        item = {create_call}
    except NotFoundError as exc:
        return 404, {{"error": str(exc)}}
    except ValidationError as exc:
        return 400, {{"error": str(exc)}}
    return 201, item.to_dict()

def handle_{prefix}_update(service, request):
    try:
        item = {update_call}
    except NotFoundError as exc:
        return 404, {{"error": str(exc)}}
    except ValidationError as exc:
        return 400, {{"error": str(exc)}}
    return 200, item.to_dict()

'''

def hard_delete(prefix):
    return f'''def handle_{prefix}_delete(service, request):
    if not service.repo.remove(request["id"]):
        return 404, {{"error": f"{prefix} not found: " + request["id"]}}
    return 200, {{"status": "deleted"}}

'''

def actions_dict(var, prefix, has_delete):
    extra = f'\n    "delete": handle_{prefix}_delete,' if has_delete else ""
    return f'''{var} = {{
    "get": handle_{prefix}_get,
    "list": handle_{prefix}_list,
    "create": handle_{prefix}_create,
    "update": handle_{prefix}_update,{extra}
}}

'''

def api_calls(e):
    name, plural = e["name"], e["plural"]
    create_method = e.get("create_method", f"create_{name}")
    return (
        f'service.get_{name}(request["id"])',
        f'service.list_{plural}(**request.get("filters", {{}}))',
        f'service.{create_method}(**request["data"])',
        f'service.update_{name}(request["id"], **request.get("changes", {{}}))',
    )

API_FILES = [
    ("product_handlers", "Handlers for the product resource.",
     [("product", True, "ACTIONS")]),
    ("customer_handlers", "Handlers for the customer resource.",
     [("customer", True, "ACTIONS")]),
    ("order_handlers", "Handlers for the order resource.",
     [("order", True, "ACTIONS")]),
    ("warehouse_handlers",
     "Handlers for the warehouse and supplier resources (grouped: both\nare partner/location entities with the same shape of CRUD).",
     [("warehouse", False, "WAREHOUSE_ACTIONS"), ("supplier", False, "SUPPLIER_ACTIONS")]),
    ("shipment_handlers",
     "Handlers for the shipment and invoice resources (grouped: both are\norder-fulfillment follow-on records).",
     [("shipment", False, "SHIPMENT_ACTIONS"), ("invoice", False, "INVOICE_ACTIONS")]),
]

for filename, doc, resources in API_FILES:
    parts = [f'"""{doc}"""\n\nfrom invsys.errors import NotFoundError, ValidationError\n\n\n']
    for name, has_delete, var in resources:
        e = BY_NAME[name]
        get_c, list_c, create_c, update_c = api_calls(e)
        parts.append(api_crud(name, get_c, list_c, create_c, update_c))
        if has_delete:
            parts.append(hard_delete(name))
        parts.append(actions_dict(var, name, has_delete))
    w(f"invsys/api/{filename}.py", "".join(parts))

w("invsys/api/stock_handlers.py", '''"""Handlers for the stock_level resource (keyed by product+warehouse,
not by a single id, so it does not fit the generic CRUD shape)."""

from invsys.errors import ConflictError, NotFoundError, ValidationError

def handle_get(service, request):
    d = request["data"]
    try:
        level = service.get_level(d["product_id"], d["warehouse_id"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    return 200, level.to_dict()

def handle_list(service, request):
    levels = service.list_levels(**request.get("filters", {}))
    return 200, {"items": [lv.to_dict() for lv in levels]}

def handle_create(service, request):
    try:
        level = service.create_level(**request["data"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    except ValidationError as exc:
        return 400, {"error": str(exc)}
    return 201, level.to_dict()

def handle_reserve(service, request):
    d = request["data"]
    try:
        level = service.reserve(d["product_id"], d["warehouse_id"], d["quantity"])
    except NotFoundError as exc:
        return 404, {"error": str(exc)}
    except ConflictError as exc:
        return 409, {"error": str(exc)}
    return 200, level.to_dict()

ACTIONS = {
    "get": handle_get,
    "list": handle_list,
    "create": handle_create,
    "reserve": handle_reserve,
}
''')

w("invsys/api/router.py", '''"""Dispatches (resource, action, request) to the right handler function."""

from invsys.api import (
    customer_handlers,
    order_handlers,
    product_handlers,
    shipment_handlers,
    stock_handlers,
    warehouse_handlers,
)

ROUTES = {
    "product": product_handlers.ACTIONS,
    "warehouse": warehouse_handlers.WAREHOUSE_ACTIONS,
    "supplier": warehouse_handlers.SUPPLIER_ACTIONS,
    "customer": customer_handlers.ACTIONS,
    "order": order_handlers.ACTIONS,
    "shipment": shipment_handlers.SHIPMENT_ACTIONS,
    "invoice": shipment_handlers.INVOICE_ACTIONS,
    "stock_level": stock_handlers.ACTIONS,
}

def route(resource, action, service, request):
    """Dispatch to the handler for (resource, action); returns
    (404, {"error": ...}) for an unknown resource/action instead of
    raising."""
    actions = ROUTES.get(resource)
    if actions is None:
        return 404, {"error": f"unknown resource: {resource!r}"}
    handler = actions.get(action)
    if handler is None:
        return 404, {"error": f"unknown action {action!r} for resource {resource!r}"}
    return handler(service, request)
''')

# invsys/cli/*.py

w("invsys/cli/__init__.py", '"""Command-line interface: argparse subcommands wired up in main.py."""\n')

def cli_module(doc, names):
    parts = [f'"""{doc}"""\n\n\n']
    reg = []
    for name in names:
        plural = BY_NAME[name]["plural"]
        cli_name = name.replace("_", "-")
        parts.append(f'''def cmd_{name}_list(args, ctx):
    """Print every {name}, one dict per line."""
    for item in ctx["{name}_service"].list_{plural}():
        print(item.to_dict())
    return 0

''')
        reg.append(f'    sub.add_parser("{cli_name}-list").set_defaults(func=cmd_{name}_list)\n')
    parts.append("def register(sub):\n" + "".join(reg))
    return "".join(parts)

w("invsys/cli/product_commands.py",
  cli_module("Product-related commands.", ["product"]))
w("invsys/cli/order_commands.py",
  cli_module("Order-fulfillment commands: orders, shipments, invoices.",
             ["order", "shipment", "invoice"]))
w("invsys/cli/partner_commands.py",
  cli_module("Commands for partner/location entities: warehouses, suppliers.",
             ["warehouse", "supplier"]))
w("invsys/cli/customer_commands.py",
  cli_module("Customer-related commands.", ["customer"]))

w("invsys/cli/main.py", '''"""CLI entry point: wires repos/services and dispatches to subcommands."""

import argparse
import sys

from invsys.cli import customer_commands, order_commands, partner_commands, product_commands
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
from invsys.services.reporting import ReportingService
from invsys.services.shipment_service import ShipmentService
from invsys.services.stock_service import StockService
from invsys.services.supplier_service import SupplierService
from invsys.services.warehouse_service import WarehouseService

def build_context():
    """Construct every repo and service, wired together, for one CLI run
    (a fresh, empty in-memory store each time the CLI is invoked)."""
    product_repo, warehouse_repo = ProductRepo(), WarehouseRepo()
    supplier_repo, customer_repo = SupplierRepo(), CustomerRepo()
    order_repo, shipment_repo = OrderRepo(), ShipmentRepo()
    invoice_repo, stock_repo = InvoiceRepo(), StockLevelRepo()
    return {
        "product_service": ProductService(product_repo),
        "warehouse_service": WarehouseService(warehouse_repo),
        "supplier_service": SupplierService(supplier_repo),
        "customer_service": CustomerService(customer_repo),
        "order_service": OrderService(order_repo, customer_repo, warehouse_repo, product_repo),
        "shipment_service": ShipmentService(shipment_repo, order_repo),
        "invoice_service": InvoiceService(invoice_repo, order_repo, customer_repo),
        "stock_service": StockService(stock_repo, product_repo),
        "reporting_service": ReportingService(product_repo, order_repo, customer_repo, stock_repo),
    }

def build_parser():
    parser = argparse.ArgumentParser(prog="invsys")
    sub = parser.add_subparsers(dest="command", required=True)
    product_commands.register(sub)
    order_commands.register(sub)
    partner_commands.register(sub)
    customer_commands.register(sub)
    return parser

def main(argv, ctx=None):
    """Run the invsys CLI (ctx lets callers/tests inject a pre-built
    context instead of an empty one). Returns the process exit code."""
    try:
        args = build_parser().parse_args(argv)
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 2
    return args.func(args, ctx if ctx is not None else build_context())

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
''')
PYEOF
