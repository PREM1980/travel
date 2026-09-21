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

## Claude

Set `LLM_PROVIDER=ANTHROPIC`, `ANTHROPIC_API_KEY`, and optionally `ANTHROPIC_MODEL` in your local `.env`. Claude's API-reported input and output tokens are stored with each Claude assistant chat message. The signed-in user's Settings page shows their aggregate usage.

## Data handling

Passwords are stored with PBKDF2-SHA256 hashes and 600,000 iterations. Authentication uses opaque, HTTP-only session cookies stored as token hashes in PostgreSQL. Every trip, document, conversation, and message is scoped to its owner through the authenticated user ID.
