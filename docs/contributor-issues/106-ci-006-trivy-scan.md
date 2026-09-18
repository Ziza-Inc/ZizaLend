---
title: "Run the container image scan and act on its result"
area: ci-cd
difficulty: intermediate
labels: ["ci-cd", "docker", "infrastructure", "security"]
---

## Context

A `.trivyignore` file exists, which means a scan was configured at some point. Whether it still runs, whether the ignore file is still justified, and whether a new high-severity finding would fail anything are all unverified. An ignore file with no owner accumulates suppressions nobody can defend.

## Task

- Confirm the scan runs in CI and fails on high and critical findings
- Review each entry in `.trivyignore` and either remove it or record the reason and a review date
- Document the response process for a new finding

## Definition of Done

- High and critical findings fail the build
- Every suppression carries a reason

## Relevant files

- `.trivyignore`
- `.github/workflows/`
