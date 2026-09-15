#!/usr/bin/env bash
python3 - <<'PYEOF'
import difflib

FILES = ["auth.py", "cache.py", "db.py", "email_utils.py", "pricing.py", "queue.py", "search.py", "utils.py"]
BUGGY_FILE = "pricing.py"
BUGGY_FUNC = "apply_bulk_discount"


def make_module_lines(name, n_funcs=10):
    lines = []
    lines.append(f'"""{name} - part of the billing/back-office service."""')
    lines.append("")
    lines.append("")
    for i in range(n_funcs):
        fname = f"helper_{i:02d}"
        lines.append(f"def {fname}(x, y=1):")
        lines.append(f'    """Small helper #{i} used by {name}."""')
        lines.append("    total = x + y")
        lines.append(f"    for step in range({(i % 4) + 1}):")
        lines.append(f"        total += step * {i + 1}")
        lines.append("    return total")
        lines.append("")
        lines.append("")
    return lines


def edit_module(lines, name, edit_indices):
    """Return a modified copy: cosmetic edits at the given helper indices."""
    out = list(lines)
    for idx in edit_indices:
        base = 3 + idx * 8
        for off in range(8):
            li = base + off
            if li < len(out):
                out[li] = out[li].replace("total", "result")
        doc_line = base + 1
        out.insert(doc_line + 1, f"    # reviewed as part of the {name} cleanup pass")
    return out


def pricing_module_lines(n_funcs=10, bug=False):
    lines = []
    lines.append('"""pricing.py - part of the billing/back-office service."""')
    lines.append("")
    lines.append("")
    inserted = False
    for i in range(n_funcs):
        if i == 4:
            op = "<" if bug else "<="
            lines.append(f"def {BUGGY_FUNC}(price, quantity, discount_threshold=10, discount_rate=0.1):")
            lines.append('    """Apply a bulk discount once quantity is above the threshold."""')
            lines.append(f"    if quantity {op} discount_threshold:")
            lines.append("        return round(price, 2)")
            lines.append("    return round(price * (1 - discount_rate), 2)")
            lines.append("")
            lines.append("")
            inserted = True
            continue
        fname = f"helper_{i:02d}"
        lines.append(f"def {fname}(x, y=1):")
        lines.append(f'    """Small helper #{i} used by pricing.py."""')
        lines.append("    total = x + y")
        lines.append(f"    for step in range({(i % 4) + 1}):")
        lines.append(f"        total += step * {i + 1}")
        lines.append("    return total")
        lines.append("")
        lines.append("")
    assert inserted
    return lines


diff_chunks = []

for fname in FILES:
    if fname == BUGGY_FILE:
        orig = pricing_module_lines(bug=False)
        mod = pricing_module_lines(bug=True)
        mod = edit_module(mod, fname, [1, 8])
    else:
        orig = make_module_lines(fname, n_funcs=10)
        mod = edit_module(orig, fname, [1, 3, 6, 8])

    orig_text = [l + "\n" for l in orig]
    mod_text = [l + "\n" for l in mod]
    diff = list(
        difflib.unified_diff(orig_text, mod_text, fromfile=f"a/{fname}", tofile=f"b/{fname}", n=2)
    )
    diff_chunks.append("".join(diff))

with open("changes.diff", "w") as f:
    f.write("\n".join(c.rstrip("\n") for c in diff_chunks) + "\n")

print(f"generated changes.diff touching {len(FILES)} files", flush=True)
PYEOF
