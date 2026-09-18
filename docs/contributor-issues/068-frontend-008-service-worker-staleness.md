---
title: "Bound service-worker cache staleness for financial data"
area: frontend
difficulty: advanced
labels: ["bug", "frontend", "security"]
---

## Context

A service worker is registered. Caching is what makes a dApp usable on a poor connection, but caching a balance or a score past its validity shows the user a number that is wrong, and a stale cache can outlive a transaction. Financial data needs a much shorter policy than shell assets.

## Task

- Separate the caching policy for app shell assets from that for API responses
- Never serve a cached API response as if it were fresh; mark it and bound its age
- Ensure a state-changing action cannot be completed from cached data
- Add a test covering an update while a stale response is cached

## Definition of Done

- API responses are never presented as fresh beyond a documented age
- App shell assets still work offline

## Relevant files

- `frontend/src/sw.ts`
- `frontend/next.config.ts`
