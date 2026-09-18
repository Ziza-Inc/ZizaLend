---
title: "Detect missing and unused translation keys"
area: frontend
difficulty: beginner
labels: ["frontend", "good first issue", "help wanted"]
---

## Context

The app is localised. Nothing checks that every key referenced in code exists in every locale file, or that keys no longer referenced are removed. A missing key renders its own identifier, which is visible and embarrassing; an unused key is dead weight that grows without bound.

## Task

- Add a check that every referenced key exists in every locale
- Report keys present in no locale and keys present in a locale but referenced nowhere
- Wire the check into CI

## Definition of Done

- A missing key fails CI with the key named
- The check runs on every pull request

## Relevant files

- `frontend/src/app/`
- `frontend/package.json`
