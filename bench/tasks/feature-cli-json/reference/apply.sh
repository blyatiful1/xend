#!/usr/bin/env bash
cat > wc_cli.py <<'PYEOF'
#!/usr/bin/env python3
import argparse
import json


def analyze(text):
    lines = text.splitlines()
    words = text.split()
    return {
        "lines": len(lines),
        "words": len(words),
        "chars": len(text),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Count lines, words, and characters in a file.")
    parser.add_argument("path", help="path to the text file")
    parser.add_argument("--json", action="store_true", help="print stats as JSON")
    args = parser.parse_args(argv)

    with open(args.path, "r") as f:
        text = f.read()

    stats = analyze(text)
    if args.json:
        print(json.dumps(stats))
    else:
        print(f"lines: {stats['lines']}")
        print(f"words: {stats['words']}")
        print(f"chars: {stats['chars']}")


if __name__ == "__main__":
    main()
PYEOF
