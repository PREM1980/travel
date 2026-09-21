from pathlib import Path

from travel_api.app import staged_documents


def test_staged_documents_are_private_and_removed_after_the_agent_run() -> None:
    documents = [
        {"id": "doc-123", "filename": "../flight.pdf", "data": b"%PDF-1.7 travel details"},
    ]

    with staged_documents("plan-456", documents) as workspace:
        staged_file = next(Path(workspace).iterdir())

        assert staged_file.name == "doc-123-flight.pdf"
        assert staged_file.read_bytes() == b"%PDF-1.7 travel details"
        assert staged_file.stat().st_mode & 0o777 == 0o600

    assert not Path(workspace).exists()
