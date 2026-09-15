"""Hidden tests: CLI --include-deleted flag (TASK.md section 5), only on
product-list, order-list and customer-list."""

import argparse

import pytest

from invsys.cli.main import build_context, main


def test_product_list_hides_deleted_by_default(capsys):
    ctx = build_context()
    p = ctx["product_service"].create_product(
        sku="A", name="Widget", category="c", unit_price=1.0, reorder_threshold=1
    )
    ctx["product_service"].delete(p.id)
    rc = main(["product-list"], ctx=ctx)
    assert rc == 0
    assert "Widget" not in capsys.readouterr().out


def test_product_list_include_deleted_shows_it(capsys):
    ctx = build_context()
    p = ctx["product_service"].create_product(
        sku="A", name="Widget", category="c", unit_price=1.0, reorder_threshold=1
    )
    ctx["product_service"].delete(p.id)
    rc = main(["product-list", "--include-deleted"], ctx=ctx)
    assert rc == 0
    assert "Widget" in capsys.readouterr().out


def test_customer_list_include_deleted_flag(capsys):
    ctx = build_context()
    c = ctx["customer_service"].create_customer(
        name="Alice", email="a@example.com", tier="standard", credit_limit=100
    )
    ctx["customer_service"].delete(c.id)
    main(["customer-list"], ctx=ctx)
    assert "Alice" not in capsys.readouterr().out
    main(["customer-list", "--include-deleted"], ctx=ctx)
    assert "Alice" in capsys.readouterr().out


def test_order_list_include_deleted_flag(capsys):
    ctx = build_context()
    p = ctx["product_service"].create_product(sku="A", name="N", category="c", unit_price=1.0, reorder_threshold=1)
    w = ctx["warehouse_service"].create_warehouse(code="C1", name="W", region="us", capacity=10)
    c = ctx["customer_service"].create_customer(name="Alice", email="a@example.com", tier="standard", credit_limit=100)
    o = ctx["order_service"].place_order(customer_id=c.id, warehouse_id=w.id, product_id=p.id, quantity=1)
    ctx["order_service"].delete(o.id)
    main(["order-list"], ctx=ctx)
    assert o.id not in capsys.readouterr().out
    main(["order-list", "--include-deleted"], ctx=ctx)
    assert o.id in capsys.readouterr().out


def test_shipment_list_has_no_include_deleted_flag():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command")
    from invsys.cli import order_commands
    order_commands.register(sub)
    with pytest.raises(SystemExit):
        parser.parse_args(["shipment-list", "--include-deleted"])


def test_partner_commands_have_no_include_deleted_flag():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command")
    from invsys.cli import partner_commands
    partner_commands.register(sub)
    with pytest.raises(SystemExit):
        parser.parse_args(["warehouse-list", "--include-deleted"])
