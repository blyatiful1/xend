def parse_record(line):
    """Parse a single 'name=value' record line into a (name, value) tuple."""
    name, _, value = line.partition("=")
    return (name.strip(), value.strip())
