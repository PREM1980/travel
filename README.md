# Travel Planner

A private, conversation-driven travel planning application. Each account owns its trips, uploads, conversations, and messages; all durable application data is stored in PostgreSQL.

## Run locally

```sh
cp .env.example .env
docker compose up --build
```

Open http://localhost:8080. The API health endpoint is http://localhost:8000/health.
Public platform, technology, and API-route metadata is available at http://localhost:8000/metadata (or through the UI proxy at http://localhost:8080/api/metadata).

For UI-only development, run `npm install && npm run dev` in `ui/`; Vite proxies `/api` to port 8000.

## Architecture

- **`travel_api/`** — FastAPI backend. `app.py` holds the route handlers, Pydantic models, LLM prompts, and business logic; `llm.py` is a provider-agnostic wrapper around Azure OpenAI, OpenAI-compatible, and Anthropic clients.
- **`ui/`** — React + TypeScript frontend built with Vite, served by nginx in the Docker image. The nginx config proxies `/api/*` to the backend with a 10-minute read timeout, since itinerary generation runs several sequential LLM calls and can legitimately take a while.
- **PostgreSQL** — schema is created and migrated idempotently at startup (`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `app.py`), so there's no separate migration step to run.

## Features

- **Trip form** — name, dates, travelers, trip type, and one or more country/city destinations.
- **AI-generated itineraries** — a day-by-day plan with realistic visits, transport legs, and meals, exported to PDF or Excel.
- **Chat-based trip setup** — describe a trip in plain language in the "Travel Concierge" panel (destination, dates, travelers) instead of filling out the form; the app extracts structured fields and populates them for you. Once name, dates, travelers, and destination are all genuinely confirmed, it tells you to click **Generate a random plan**.
- **Travel concierge Q&A** — once a trip is saved, the same chat panel answers travel-planning questions about it. It's scoped to stay on-topic (declines non-travel requests) and guarded against prompt injection from the message content.
- **Document upload** — attach tickets, reservations, or other trip files (from the Documents panel or the chat's attach icon). Uploading automatically extracts the document's date range and any confirmed transport reservations (flight/rail/ferry/bus — operator, service number, route, times) so the planner can use them directly instead of re-reading the raw file on every generation.
- **Per-day dates** — each itinerary day shows its actual calendar date next to "Day N", computed from the trip's start date.

## How itinerary generation works

Generating a plan runs a small pipeline, not a single model call:

1. **Top places** — select 20 distinct places to visit for the trip.
2. **Itinerary** — build the day-by-day schedule from those places, plus any confirmed transport reservations from uploaded documents.
3. **Validation** — a separate pass checks the proposed itinerary for scheduling problems (overlaps, implausible meal times, missing arrival prerequisites).
4. **Correction** — if validation finds issues, a constrained correction pass revises timing only, up to twice, before the result (and any unresolved warnings) is returned to the UI.

Uploaded documents' extracted transport segments are passed into all four steps as authoritative ground truth, so a flight's confirmed times are never invented, re-derived, or "corrected" away by a later pass — they're compared against directly.

## LLM providers

Set `LLM_PROVIDER` in `.env` to one of:

| Value | Required variables | Notes |
|---|---|---|
| `AZURE_OPENAI` (default) | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` (or `MODEL_ID`) | Optional: `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_TEMPERATURE`, `AZURE_OPENAI_TIMEOUT_SECONDS` |
| `OPENAI` / `OPENAI_COMPATIBLE` / `LOCAL` | `OPENAI_API_KEY` | Optional: `MODEL_ID` or `OPENAI_MODEL`, `BASE_URL`/`OPENAI_BASE_URL` (point this at a local or self-hosted OpenAI-compatible endpoint), `OPENAI_CA_BUNDLE`, `LOCAL_MODEL_TIMEOUT_SECONDS` |
| `ANTHROPIC` / `CLAUDE` | `ANTHROPIC_API_KEY` | Optional: `ANTHROPIC_MODEL` (default `claude-sonnet-4-5`), `ANTHROPIC_TIMEOUT_SECONDS`, `ANTHROPIC_MAX_TOKENS`. When set, document uploads are handed to a Claude Agent SDK sub-agent that reads staged files directly instead of attaching raw file bytes to a chat completion request. Claude's API-reported input/output token usage is stored with each assistant chat message, and shown in aggregate on the signed-in user's Settings page. |

Document extraction and itinerary generation both call the configured provider directly; for `AZURE_OPENAI`/`OPENAI`, uploaded files are attached to the request as `input_file` content via the Responses API.

## Data handling

Passwords are stored with PBKDF2-SHA256 hashes and 600,000 iterations. Authentication uses opaque, HTTP-only session cookies stored as token hashes in PostgreSQL. Every trip, document, conversation, and message is scoped to its owner through the authenticated user ID.

## Testing

Backend tests use `pytest` and don't require Docker or real LLM credentials:

```sh
uv sync --group dev
uv run pytest tests/
```
