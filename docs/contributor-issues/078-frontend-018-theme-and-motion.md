---
title: "Respect reduced-motion and theme preferences"
area: frontend
difficulty: beginner
labels: ["frontend", "good first issue", "help wanted", "ux"]
---

## Context

The interface uses transitions and animated charts. Motion that cannot be disabled is a genuine accessibility barrier, and a theme that ignores the system preference is a papercut for every user who sets one. Both are cheap to honour and easy to regress.

## Task

- Honour `prefers-reduced-motion` across transitions and chart animation
- Honour `prefers-color-scheme` as the default, with the manual choice persisted
- Add a test or a visual check for each

## Definition of Done

- Reduced motion removes animation without removing information
- The default theme follows the system preference

## Relevant files

- `frontend/src/app/globals.css`
- `frontend/src/app/components/`
