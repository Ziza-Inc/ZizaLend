---
title: "Run a bounded fuzz campaign on a schedule"
area: contracts
difficulty: intermediate
labels: ["contracts", "github_actions", "testing"]
---

## Context

Five fuzz targets exist and CI only checks that they compile. Compiling a fuzz target proves nothing about the contract; the corpus and the crash artifacts are the point. A short scheduled campaign would catch panics that the example tests miss, without putting fuzzing on the critical path of every pull request.

## Task

- Add a scheduled workflow that runs each target for a bounded time (e.g. 60-120 seconds)
- Upload the corpus and any crash artifact
- Fail the workflow when a crash is found, and open or update an issue with the artifact attached

## Definition of Done

- A deliberately introduced `panic!` in a covered path is found by the campaign
- The workflow does not run on every pull request
- Corpus is cached between runs so coverage accumulates

## Relevant files

- `.github/workflows/`
- `contracts/fuzz/`
