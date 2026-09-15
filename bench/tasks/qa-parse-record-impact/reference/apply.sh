#!/usr/bin/env bash
cat > .xend_answer.txt <<'TXT'
Three files directly import and call parse_record from record_parser.py,
and would need to be updated:

- ingest.py
- report_builder.py
- cli.py

No other file in the project imports parse_record from record_parser.py,
so nothing else would need to change.
TXT
