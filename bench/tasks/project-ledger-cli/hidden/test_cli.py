from ledger.cli import main


def run(capsys, path, args):
    rc = main(["--file", str(path)] + args)
    out = capsys.readouterr()
    return rc, out.out, out.err


def test_cli_init_creates_file(tmp_path, capsys):
    path = tmp_path / "book.jsonl"
    rc, out, err = run(capsys, path, ["init"])
    assert rc == 0
    assert path.exists()
    assert "Initialized ledger" in out


def test_cli_init_already_exists_errors(tmp_path, capsys):
    path = tmp_path / "book.jsonl"
    run(capsys, path, ["init"])
    rc, out, err = run(capsys, path, ["init"])
    assert rc == 1
    assert "Error" in err


def test_cli_add_account_success(tmp_path, capsys):
    path = tmp_path / "book.jsonl"
    run(capsys, path, ["init"])
    rc, out, err = run(capsys, path, ["add-account", "Cash", "asset"])
    assert rc == 0
    assert "Created account Cash (asset, USD)" in out


def test_cli_add_account_duplicate_error(tmp_path, capsys):
    path = tmp_path / "book.jsonl"
    run(capsys, path, ["init"])
    run(capsys, path, ["add-account", "Cash", "asset"])
    rc, out, err = run(capsys, path, ["add-account", "Cash", "asset"])
    assert rc == 1
    assert "Error" in err


def test_cli_post_success_and_balance(tmp_path, capsys):
    path = tmp_path / "book.jsonl"
    run(capsys, path, ["init"])
    run(capsys, path, ["add-account", "Cash", "asset"])
    run(capsys, path, ["add-account", "Revenue", "income"])
    rc, out, err = run(
        capsys, path, ["post", "--date", "2024-01-01", "--description", "Sale",
                        "--entry", "Cash:100.00:debit", "--entry", "Revenue:100.00:credit"]
    )
    assert rc == 0
    assert "Posted T0001" in out
    rc, out, err = run(capsys, path, ["balance", "Cash"])
    assert rc == 0
    assert out.strip() == "Cash: 100.00"


def test_cli_trial_balance_csv_format(tmp_path, capsys):
    path = tmp_path / "book.jsonl"
    run(capsys, path, ["init"])
    run(capsys, path, ["add-account", "Cash", "asset"])
    run(capsys, path, ["add-account", "Revenue", "income"])
    run(capsys, path, ["post", "--date", "2024-01-01", "--description", "Sale",
                        "--entry", "Cash:100.00:debit", "--entry", "Revenue:100.00:credit"])
    rc, out, err = run(capsys, path, ["trial-balance", "--format", "csv"])
    assert rc == 0
    lines = out.splitlines()
    assert lines[0] == "account,debit,credit"
    assert "Cash,100.00,0.00" in lines


def test_cli_statement_text_format(tmp_path, capsys):
    path = tmp_path / "book.jsonl"
    run(capsys, path, ["init"])
    run(capsys, path, ["add-account", "Cash", "asset"])
    run(capsys, path, ["add-account", "Revenue", "income"])
    run(capsys, path, ["post", "--date", "2024-01-01", "--description", "Sale",
                        "--entry", "Cash:100.00:debit", "--entry", "Revenue:100.00:credit"])
    rc, out, err = run(capsys, path, ["statement", "Cash"])
    assert rc == 0
    lines = out.strip().splitlines()
    assert lines[0] == "Statement for Cash"
    assert "balance 100.00" in lines[1]


def test_cli_import_success(tmp_path, capsys):
    path = tmp_path / "book.jsonl"
    run(capsys, path, ["init"])
    run(capsys, path, ["add-account", "Cash", "asset"])
    run(capsys, path, ["add-account", "Revenue", "income"])
    csv_path = tmp_path / "in.csv"
    csv_path.write_text(
        "date,description,account,amount,side\n"
        "2024-01-01,Sale,Cash,50.00,debit\n"
        "2024-01-01,Sale,Revenue,50.00,credit\n"
    )
    rc, out, err = run(capsys, path, ["import", str(csv_path)])
    assert rc == 0
    assert "Imported 1 transaction(s)" in out


def test_cli_import_with_errors_returns_1(tmp_path, capsys):
    path = tmp_path / "book.jsonl"
    run(capsys, path, ["init"])
    run(capsys, path, ["add-account", "Cash", "asset"])
    run(capsys, path, ["add-account", "Revenue", "income"])
    csv_path = tmp_path / "in.csv"
    csv_path.write_text(
        "date,description,account,amount,side\n"
        "2024-01-01,Sale,Cash,notanumber,debit\n"
        "2024-01-01,Sale,Revenue,50.00,credit\n"
    )
    rc, out, err = run(capsys, path, ["import", str(csv_path)])
    assert rc == 1
    assert "Imported 0 transaction(s)" in out
    assert "error(s)" in err


def test_cli_export_to_stdout(tmp_path, capsys):
    path = tmp_path / "book.jsonl"
    run(capsys, path, ["init"])
    run(capsys, path, ["add-account", "Cash", "asset"])
    run(capsys, path, ["add-account", "Revenue", "income"])
    run(capsys, path, ["post", "--date", "2024-01-01", "--description", "Sale",
                        "--entry", "Cash:100.00:debit", "--entry", "Revenue:100.00:credit"])
    rc, out, err = run(capsys, path, ["export"])
    assert rc == 0
    lines = out.splitlines()
    assert lines[0] == "date,description,account,amount,side"
    assert "2024-01-01,Sale,Cash,100.00,debit" in lines


def test_cli_usage_error_missing_file_flag(capsys):
    rc = main(["init"])
    capsys.readouterr()
    assert rc == 2
