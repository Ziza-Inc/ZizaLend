---
title: "Document and automate the release process"
area: ci-cd
difficulty: intermediate
labels: ["ci-cd", "documentation", "infrastructure"]
---

## Context

Contracts are versioned in storage and expose `version()`, and `migrate()` handles a version bump. There is no document covering when to bump, how to record the deployed revision, or how to roll forward a deployed contract. That is the process an operator needs at the moment they need it most.

## Task

- Document the contract release process: version bump, migration, deployment, verification
- Automate tagging and the changelog from conventional commits
- Tie the deployment manifest to the tag

## Definition of Done

- The process can be followed without reading the Rust
- A tag produces a changelog entry

## Relevant files

- `docs/runbooks/`
- `.github/workflows/`
