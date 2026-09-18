---
title: "Enforce a coverage threshold in CI instead of uploading a report"
area: testing
difficulty: intermediate
labels: ["github_actions", "testing"]
---

## Context

CI runs `cargo tarpaulin` and uploads `cobertura.xml` as an artefact. Nothing reads it. Coverage that is measured but not enforced trends down, and the report is only consulted during an audit, when it is too late to fix cheaply.

## Task

- Measure current line coverage per contract
- Set a threshold below the current level and fail under it
- Exclude generated and FFI-only code deliberately, with the exclusions justified
- Publish the number in a badge or a summary so a regression is visible on the pull request

## Definition of Done

- Coverage is at or above the threshold
- A deliberately uncovered module fails the gate

## Relevant files

- `.github/workflows/ci.yml`
- `contracts/`
