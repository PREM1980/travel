import sys
from types import SimpleNamespace

from travel_api import llm


def test_anthropic_response_includes_api_reported_token_usage(monkeypatch) -> None:
    class FakeAnthropic:
        def __init__(self, **kwargs):
            assert kwargs["api_key"] == "test-key"

        @property
        def messages(self):
            return SimpleNamespace(
                create=lambda **kwargs: SimpleNamespace(
                    content=[SimpleNamespace(type="text", text="Claude reply")],
                    usage=SimpleNamespace(input_tokens=17, output_tokens=9),
                )
            )

    monkeypatch.setenv("LLM_PROVIDER", "ANTHROPIC")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("ANTHROPIC_MODEL", "claude-test")
    monkeypatch.setitem(sys.modules, "anthropic", SimpleNamespace(Anthropic=FakeAnthropic))

    response = llm.generate_response("Hello")

    assert response.content == "Claude reply"
    assert response.provider == "anthropic"
    assert response.model == "claude-test"
    assert (response.input_tokens, response.output_tokens) == (17, 9)


def test_anthropic_requires_an_api_key(monkeypatch) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "ANTHROPIC")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    try:
        llm.generate_response("Hello")
    except EnvironmentError as error:
        assert "ANTHROPIC_API_KEY" in str(error)
    else:
        raise AssertionError("Expected a missing API key error")


def test_document_generation_uses_the_read_only_claude_agent(monkeypatch) -> None:
    async def fake_agent(prompt: str, workspace: str) -> str:
        assert prompt == "Plan around the uploaded reservation"
        assert workspace == "/tmp/plan-documents"
        return '{"itinerary": []}'

    monkeypatch.setenv("LLM_PROVIDER", "ANTHROPIC")
    monkeypatch.setattr(llm, "_run_document_agent", fake_agent)

    assert llm.generate_itinerary("Plan around the uploaded reservation", "/tmp/plan-documents") == '{"itinerary": []}'


def test_openai_document_generation_passes_database_bytes_as_file_input(monkeypatch) -> None:
    class FakeOpenAI:
        def invoke(self, messages):
            content = messages[0].content
            assert content[0] == {"type": "input_text", "text": "Plan around the uploaded reservation"}
            assert content[1]["type"] == "input_file"
            assert content[1]["filename"] == "flight.pdf"
            assert content[1]["file_data"] == "data:application/pdf;base64,cGRmIGJ5dGVz"
            return SimpleNamespace(content='{"itinerary": []}')

    monkeypatch.setenv("LLM_PROVIDER", "OPENAI")
    monkeypatch.setattr(llm, "_llm", lambda **_: FakeOpenAI())

    assert llm.generate_itinerary(
        "Plan around the uploaded reservation",
        document_files=[{"filename": "flight.pdf", "content_type": "application/pdf", "data": b"pdf bytes"}],
    ) == '{"itinerary": []}'
