---
title: "Generate per-route metadata and social previews"
area: frontend
difficulty: beginner
labels: ["documentation", "frontend", "good first issue", "help wanted"]
---

## Context

A sitemap and robots configuration exist. Per-route titles and descriptions are what make a shared link legible; without them every page shares one title, which weakens the project's discoverability and makes shared links look like spam.

## Task

- Add title and description metadata to every route, localised
- Add Open Graph and Twitter card metadata with a real preview image
- Verify the sitemap lists the localised routes

## Definition of Done

- Each route has a distinct title and description
- A shared link renders a preview card

## Relevant files

- `frontend/src/app/`
- `frontend/src/app/sitemap.ts`
