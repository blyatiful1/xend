from record_parser import parse_record


def build_report(lines):
    rows = []
    for line in lines:
        name, value = parse_record(line)
        rows.append(f"{name}: {value}")
    return "\n".join(rows)
