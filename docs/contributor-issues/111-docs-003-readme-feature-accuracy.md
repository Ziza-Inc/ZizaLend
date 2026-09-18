---
title: "Verify every claim in the README against the implementation"
area: docs
difficulty: beginner
labels: ["documentation", "good first issue", "help wanted"]
---

## Context

The README describes features, architecture, and setup. Some claims drift as the code moves, and a README that overstates is worse than a terse one: a reviewer who finds one false claim discounts the rest, including the true ones.

## Task

- Walk every feature claim and confirm the code supports it
- Remove or qualify anything not implemented
- Add a pointer from each claim to the file it lives in, so the next reader can check cheaply

## Definition of Done

- No claim in the README is unsupported by the code
- Each major claim links to its implementation

## Relevant files

- `README.md`
