---
title: "Cache dependencies consistently to cut CI duration"
area: ci-cd
difficulty: intermediate
labels: ["ci-cd", "github_actions", "infrastructure"]
---

## Context

Some jobs cache `npm` dependencies and the Rust jobs use a cache action. The remaining jobs — the packages job installs dependencies without a cache, for instance — re-download on every run. Consistent caching shortens feedback, and short feedback is what makes contributors run the suite before pushing.

## Task

- Audit each job's dependency installation and add caching where it is missing
- Key the cache on the lockfile so it invalidates correctly
- Measure the before and after duration and record it

## Definition of Done

- Every job that installs dependencies caches them
- Cache keys invalidate on a lockfile change

## Relevant files

- `.github/workflows/`
