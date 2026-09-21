# Implementation Plan: Uploaded document date validation

## Overview
Add a validated, additive conflict result to the existing upload flow and render it in the planner.

## Architecture decisions
- Use a constrained validator prompt and Pydantic model; normal code compares ISO dates.
- Return conflict data only with the upload response; no database migration or automatic update.

## Task list
1. Add extraction and deterministic conflict logic with unit coverage.
2. Extend the upload response and show the review notice in the UI.

## Risks and mitigations
| Risk | Mitigation |
| --- | --- |
| Model returns malformed dates | Validate output and treat it as no extracted conflict. |
| Extraction provider fails | Preserve the upload and continue existing recalculation behavior. |
