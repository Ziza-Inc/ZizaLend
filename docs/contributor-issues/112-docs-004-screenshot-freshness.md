---
title: "Keep screenshots current and generated rather than pasted"
area: docs
difficulty: intermediate
labels: ["documentation", "frontend"]
---

## Context

Documentation includes screenshots of the interface. Pasted screenshots age immediately, and a stale screenshot is the fastest way to make an otherwise accurate document look neglected. Generating them from the running app, as part of a documented step, keeps them honest.

## Task

- Add a documented script that captures the main screens from a running instance
- State the revision each capture came from
- Re-capture as part of the release checklist

## Definition of Done

- The capture can be reproduced from the repository
- The README states when the images were taken

## Relevant files

- `docs/`
- `scripts/`
- `README.md`
