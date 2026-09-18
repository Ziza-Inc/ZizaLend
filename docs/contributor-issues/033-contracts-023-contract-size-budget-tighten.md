---
title: "Tighten the WASM size budget from 256 KiB to a measured ceiling"
area: contracts
difficulty: beginner
labels: ["contracts", "good first issue", "help wanted"]
---

## Context

CI enforces 256 KiB per artifact, which was chosen as a generous starting point before any baseline existed. The largest artifact is roughly 89 KiB, so the budget currently permits a 3x regression without complaint and therefore enforces nothing.

## Task

- Measure every artifact on the current revision
- Set the budget to the measured size plus a documented margin (e.g. 10%), per contract
- Confirm the failure message tells a contributor which contract grew and by how much

## Definition of Done

- The budget is derived from a measurement, not chosen arbitrarily
- A test or comment records the measurement date and the sizes it was based on

## Relevant files

- `.github/workflows/ci.yml`
- `contracts/`
