# ledger

A double-entry bookkeeping ledger with JSONL persistence and a CLI. The
full specification is in `SPEC.md` — implement it exactly as written.

## Running the tests

```bash
python3 -m pytest -q tests
```

`tests/` holds a handful of public example tests covering the basic happy
paths. A much larger hidden test suite (covering every requirement in
`SPEC.md`, including error paths and edge cases) is run separately after
you're done — passing the public tests is necessary but not sufficient.

Implement the package under `ledger/` (six modules: `model.py`, `store.py`,
`journal.py`, `report.py`, `importer.py`, `cli.py`). Standard library only,
no third-party dependencies.
