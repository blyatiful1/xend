#!/usr/bin/env bash
python3 - <<'PYEOF'
import re

for path in ("pricing/core.py", "pricing/order.py", "pricing/invoice.py", "pricing/report.py"):
    with open(path) as f:
        content = f.read()
    content = re.sub(r'\bcalc_total\b', 'compute_total_with_tax', content)
    with open(path, "w") as f:
        f.write(content)
PYEOF
