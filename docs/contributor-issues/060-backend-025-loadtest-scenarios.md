---
title: "Extend the load test to the read paths users actually hit"
area: backend
difficulty: intermediate
labels: ["backend", "infrastructure", "testing"]
---

## Context

A k6 load test workflow exists and is dispatch-only. If it exercises only a health endpoint it measures nothing about the system under real use, where the expensive paths are the dashboards: loan lists with filters, score history, and pool statistics, each of which touches the database and often the cache.

## Task

- Add scenarios for the dashboard read paths and the transaction submission path
- Define pass-fail thresholds (p95 latency, error rate) rather than reporting numbers only
- Document how to run it against staging and what the current baseline is

## Definition of Done

- The scenarios cover the dashboard endpoints, not just health
- A regression in p95 latency fails the run

## Relevant files

- `scripts/loadtest/`
- `.github/workflows/loadtest.yml`
