# Per-destination dates for multi-city trips

## Problem

A trip today has a single `start_date`/`end_date` and an ordered list of destinations (`country`, `city`) with no date information of their own. For a multi-city trip (e.g., 3 days in Paris then 4 in Rome), there is no way to express which days belong to which city — the itinerary is generated as one flat sequence of `day_number`s against one place list drawn from all destinations combined.

## Goal

Each destination gets its own `start_date`/`end_date`. The trip's overall dates become derived from its destinations. Itinerary generation, the day-by-day UI, and PDF/Excel export all become destination-aware, so a multi-city trip produces a plan grouped by city with a sensible intercity transport leg between them.

## Scope for this iteration

- Trip form UI and itinerary generation/export are destination-aware.
- Chat-based trip setup (`/trips/parse`) is **out of scope** — it keeps working exactly as today (destinations + one overall date range). Extending its extraction and confirmed-fields tracking to also parse and assign per-destination ranges is real added complexity, left for a follow-up.
- No new database table for destinations' relationship to itinerary items — day-to-destination mapping is computed, never stored.

## Data model

- `Destination` (frontend TS type, `ui/src/App.tsx`) gains:
  ```ts
  type Destination = { country: string; city: string; start_date?: string; end_date?: string };
  ```
- `Destination` (backend Pydantic model, `travel_api/app.py`) gains the same two nullable fields:
  ```python
  class Destination(BaseModel):
      country: str
      city: str
      start_date: str | None = None
      end_date: str | None = None
  ```
- Schema migration (idempotent, following the existing pattern in `SCHEMA`):
  ```sql
  ALTER TABLE trip_destinations ADD COLUMN IF NOT EXISTS start_date DATE;
  ALTER TABLE trip_destinations ADD COLUMN IF NOT EXISTS end_date DATE;
  ```
- `TripWrite.start_date` / `TripWrite.end_date` remain present (existing consumers — export filenames, prompts, validation — read them), but they become **derived, not directly user-edited**:
  - The frontend computes them as `min(destination.start_date)` / `max(destination.end_date)` across destinations that have dates set, and sends the computed values as part of the normal save payload — no protocol change.
  - The backend's existing `start_date <= end_date` check on `TripWrite` remains as a defense-in-depth backstop; no new backend derivation logic is added.

## Validation

All computed in one place, e.g. a new `destinationDateIssues(destinations)` helper alongside the existing `missingFieldLabels`/`fieldInvalid`:

- A destination with both dates set must have `start_date <= end_date`.
- Destinations must be non-overlapping (by more than a single shared day) in list order: for consecutive destinations, `next.start_date >= previous.end_date` — this rejects genuine overlaps (the next city starting before the previous one ends) while allowing both a shared transition day (`next.start_date == previous.end_date`, the common "Paris Jun 1–5, Rome Jun 5–9" way of describing a trip) and any size gap.
- A day that falls on a shared transition day belongs to the *arriving* destination (the one whose range starts that day) for day-to-destination mapping, itinerary generation, and heading purposes; the intercity transport leg is placed as that day's first item, consistent with the "first day of a new destination" rule below.
- Every destination must have both dates set before `canGenerateRandomPlan` returns true — this extends the existing gate the same way the "trip name" / "dates" / "number of travelers" checks already work.
- Errors surface via the existing `fieldInvalid`-style red-border mechanism, scoped to the specific destination row and field.

## Form UI

- Each destination row (`ui/src/App.tsx`, the `.destinations` block) gets two additional date inputs (From/To) next to Country/City. This applies uniformly — even a single-destination trip has its own row-level date range; there is no separate "multi-city mode."
- The top-level From/To fields become **read-only**, displaying the derived overall range, with a caption ("Set from your destinations below.") explaining why they're not directly editable.
- Adding a new destination (`+ Add destination`) defaults its range to start the day after the previous destination's `end_date`, spanning a default 3 days — a starting point, not a constraint.
- **Existing trips with no per-destination dates** (every current trip, until edited): handled client-side the first time such a trip is opened for editing —
  - Exactly one destination: it silently inherits the trip's current `start_date`/`end_date`.
  - Multiple destinations: the current overall range is evenly split across them in list order as an adjustable starting point.
  - This is a one-time client-side fill-in on load, not a database migration script — no data is written until the user saves.

## Itinerary generation

Day-to-destination mapping is **derived, never stored** — given the trip's destinations (each with a date range) and `trip.start_date`, any `day_number` maps to either a specific destination or "free day" (a gap) by simple date arithmetic. This mapping is computed wherever it's needed: the generation prompts, the frontend day headings, and the PDF/Excel export — no new column on `itinerary_items`.

- `_top_places_prompt` runs **once per destination** instead of once for the whole trip, each call scoped to that city, with a place count proportional to that destination's day count (roughly 20 for a single-city trip; split across cities for multi-city, weighted by each city's share of days). This keeps "visit" items on a given day drawing only from that day's own city's place list — enforced the same way `is_top_place_visit` already checks against the supplied list today.
- `_itinerary_prompt` receives, for each day_number, which destination (or "free day") it belongs to, and gets a new **intercity-transport contract**: the first day of a new destination must include a transport item for the leg from the previous city, with an estimated mode and duration — never an invented specific booking, time, or price, unless a confirmed reservation exists for that leg (same restraint the flight-handling contract already applies).
- A "free day" (gap) is exempted from the existing day-length contract's forced 09:00–18:00 sightseeing block: the model may suggest light optional activities, but must not pad the day to look like a full sightseeing day, and the day must be clearly labeled as free/flex (in its title/notes).
- Day headings become `Day N — <City> — <date>` in the UI (`dayDateLabel`) and PDF export (`day_label`), or `Day N — Free day — <date>` for a gap. Excel's per-row "Day" column is unaffected (out of scope, per the earlier decision not to touch it).

## Error handling

- Invalid per-destination dates block generation the same way any other missing/invalid field does today (`canGenerateRandomPlan` false, red-highlighted fields, "still needed" messaging where applicable) — no new class of error, reusing existing UI patterns.
- If per-destination validation somehow fails server-side (defense in depth; the frontend should never send an invalid range), `generate_validated_itinerary`'s existing 422 pattern is reused — a new check alongside the current name/dates/destinations checks at its top, with a message identifying which destination pair is out of order.

## Testing

- Backend: unit tests for the new destination-ordering/overlap validation (mirroring the existing tests in `tests/test_generation_limits.py` for trip-level date validation), and for the per-destination top-places prompt construction.
- Frontend: manual verification in the browser (per this session's established practice) covering: single-destination trip (no visible behavior change), a new multi-city trip with a gap day, and an existing trip opened for the first time after this ships (confirms the client-side backfill behaves as designed).
- End-to-end: a real generation run for a 2-city trip with a gap day, checking the saved itinerary's day_number-to-city mapping and the intercity transport row, the same way prior itinerary-shape fixes in this session were verified against a live Azure OpenAI call rather than assumed from the prompt text alone.

## Out of scope (explicitly deferred)

- Chat-based (`/trips/parse`) per-destination date extraction.
- Any change to Excel export's per-row "Day" column.
- Storing day-to-destination mapping in the database (kept derived).
