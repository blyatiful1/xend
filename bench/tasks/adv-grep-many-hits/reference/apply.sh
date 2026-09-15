#!/usr/bin/env bash
python3 - <<'PYEOF'
import glob
import re

with open("moneymod/fmt.py", "w") as f:
    f.write(
        '_SYMBOLS = {"USD": "$", "EUR": "\\u20ac", "GBP": "\\u00a3"}\n'
        "\n"
        "\n"
        "def fmt_money(x, currency=\"USD\"):\n"
        '    """Format a numeric amount as a money string in the given currency."""\n'
        "    symbol = _SYMBOLS.get(currency, currency + \" \")\n"
        '    return f"{symbol}{x:,.2f}"\n'
    )

for path in sorted(glob.glob("moneymod/mod_*.py")):
    with open(path) as f:
        src = f.read()
    if "from moneymod import cfg" not in src:
        src = src.replace(
            "from moneymod.fmt import fmt_money\n",
            "from moneymod.fmt import fmt_money\nfrom moneymod import cfg\n",
            1,
        )
    src = re.sub(r'fmt_money\(amount\)', 'fmt_money(amount, currency=cfg.CURRENCY)', src)
    with open(path, "w") as f:
        f.write(src)
PYEOF
