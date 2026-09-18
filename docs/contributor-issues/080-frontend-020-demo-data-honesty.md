---
title: "Make demo and seeded data visibly demo data"
area: frontend
difficulty: beginner
labels: ["frontend", "good first issue", "help wanted"]
---

## Context

Seed data exists for local development. If it can be presented on a deployed instance without any indication, a reviewer or a user can mistake seeded rows for real activity, which misrepresents the project and undermines the one claim the project makes.

## Task

- Gate the seed script on a non-production environment
- If demo data can be shown on a deployed instance, label it in the UI
- Document what the deployed Testnet instance is showing

## Definition of Done

- Seeding refuses to run against production
- Any synthetic data on a deployed instance is labelled

## Relevant files

- `backend/src/seed/`
- `frontend/src/app/`
