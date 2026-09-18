---
title: "Review metric labels for unbounded cardinality"
area: backend
difficulty: intermediate
labels: ["backend", "infrastructure"]
---

## Context

Prometheus metrics are exported from the middleware and a job-metrics service. A label whose value is a user id, a loan id, or a raw path turns each distinct value into a separate time series, and unbounded cardinality is the most common way a metrics backend falls over.

## Task

- Audit every metric for labels with unbounded value sets
- Replace identifiers with bounded enumerations (route template instead of raw path, status class instead of status code where the set is open)
- Add a test or a check that the label values of each metric come from a declared, bounded set

## Definition of Done

- No metric label takes a user-supplied or unbounded value
- The declared label domains are asserted, not just documented

## Relevant files

- `backend/src/middleware/metrics.ts`
- `backend/src/services/jobMetricsService.ts`
