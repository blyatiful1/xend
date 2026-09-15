import sys

from record_parser import parse_record


def main(argv):
    for line in argv:
        name, value = parse_record(line)
        print(f"{name} -> {value}")


if __name__ == "__main__":
    main(sys.argv[1:])
