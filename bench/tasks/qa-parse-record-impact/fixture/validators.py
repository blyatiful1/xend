def is_valid_email(address):
    return "@" in address and "." in address.split("@")[-1]


def is_valid_username(name):
    return name.isalnum() and 3 <= len(name) <= 20
