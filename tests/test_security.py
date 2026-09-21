from travel_api.app import password_hash, password_matches


def test_password_hashes_are_salted_and_verifiable() -> None:
    first = password_hash("safe-password")
    second = password_hash("safe-password")

    assert first != second
    assert password_matches("safe-password", first)
    assert not password_matches("wrong-password", first)
