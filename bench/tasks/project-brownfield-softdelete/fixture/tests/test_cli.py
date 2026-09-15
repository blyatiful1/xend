"""Public example tests for the cli layer."""

from invsys.cli.main import build_context, main


def test_product_list_prints_created_products(capsys):
    ctx = build_context()
    ctx["product_service"].create_product(
        sku="A", name="Widget", category="c", unit_price=1.0, reorder_threshold=1
    )
    rc = main(["product-list"], ctx=ctx)
    assert rc == 0
    out = capsys.readouterr().out
    assert "Widget" in out


def test_customer_list_empty(capsys):
    ctx = build_context()
    rc = main(["customer-list"], ctx=ctx)
    assert rc == 0
    assert capsys.readouterr().out == ""


def test_unknown_command_is_usage_error():
    ctx = build_context()
    rc = main(["bogus-command"], ctx=ctx)
    assert rc == 2


def test_help_exits_zero():
    ctx = build_context()
    rc = main(["--help"], ctx=ctx)
    assert rc == 0
