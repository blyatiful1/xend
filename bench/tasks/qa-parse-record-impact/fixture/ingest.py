from record_parser import parse_record


def ingest_lines(lines):
    records = []
    for line in lines:
        name, value = parse_record(line)
        records.append({"name": name, "value": value})
    return records
