def parse_record(raw_bytes):
    """Deprecated binary record parser from the old ingestion pipeline.

    This is a different, unrelated function from record_parser.parse_record.
    Nothing in the current codebase imports this; kept for historical
    reference only.
    """
    return raw_bytes.decode("utf-8", errors="ignore")
