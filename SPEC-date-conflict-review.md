# Spec: Uploaded document date validation

## Objective
Validate every uploaded trip document with a validator-style model call and show the traveler a review notice when its extracted date range conflicts with the saved trip range. The system must never change trip dates automatically.

## Contract
`POST /trips/{trip_id}/documents` adds an optional `date_conflict` object to its existing successful response. It contains the uploaded filename, extracted start/end dates, and a human-readable conflict message. It is omitted when no reliable conflicting range is found.

## Boundaries
- Always: validate structured model output; preserve uploads when extraction fails.
- Ask first: database schema changes or new dependencies.
- Never: expose document contents to the browser, silently update dates, or reject an upload solely because date extraction is unavailable.

## Success criteria
- Every upload runs document-date extraction before itinerary recalculation.
- A valid conflicting range is returned and displayed after upload.
- Matching, incomplete, invalid, and extraction-failure results do not block uploads.
- Backend tests and the UI build pass.
