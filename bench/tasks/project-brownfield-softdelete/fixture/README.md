# invsys

An in-memory inventory management system: products, warehouses,
suppliers, customers, orders, shipments, invoices and stock levels,
layered as models -> repos -> services -> api / cli, plus a small set of
shared utilities. Standard library only, Python 3.11.

```
invsys/
  models/    dataclasses (validation, to_dict/from_dict)
  repos/     one in-memory CRUD store per entity, sharing BaseRepo
  services/  business logic, one service per entity, plus reporting.py
  api/       dict-request-in, (status, body)-tuple-out handlers, routed
             by api/router.py
  cli/       argparse subcommands, wired up in cli/main.py
  utils/     ids, clock, validation helpers shared across layers
```

The change to make is described in `TASK.md` — read it before touching
any code; it pins the exact names, signatures and status codes the
hidden test suite checks.

## Running the tests

```bash
python3 -m pytest -q tests
```

`tests/` holds a set of public tests covering today's behaviour (before
the change in `TASK.md`) — they must keep passing after you're done. A
much larger hidden test suite covering every requirement in `TASK.md`
runs separately afterwards; passing the public tests is necessary but not
sufficient.
