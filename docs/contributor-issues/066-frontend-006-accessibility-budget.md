---
title: "Make the accessibility audit a gate rather than a script"
area: frontend
difficulty: intermediate
labels: ["frontend", "testing", "ux"]
---

## Context

`npm run audit:a11y` builds the app and runs axe, but nothing depends on its result. A script that nobody runs in CI is a script that becomes wrong. The audit also currently covers whatever pages the default Playwright config visits, which may not include the wizards where accessibility problems actually bite.

## Task

- Point the audit at the flows that matter: connect wallet, request a loan, repay, lend, view activity
- Fail on serious and critical violations
- Publish the report as a CI artefact so a regression is attributable
- Record the current violation count so the gate can be tightened deliberately

## Definition of Done

- CI fails on a newly introduced serious violation
- The audited route list includes the transaction wizards

## Relevant files

- `frontend/package.json`
- `.github/workflows/ci.yml`
- `frontend/e2e/`
