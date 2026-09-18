---
title: "Verify whether `stellar contract optimize` changes any artifact"
area: contracts
difficulty: beginner
labels: ["contracts", "good first issue"]
---

## Context

`scripts/build.sh` runs `stellar contract optimize` when the CLI is available, producing a separate `.optimized.wasm` that nothing else in the repository references. The deploy config points at the unoptimised path. Either the optimisation matters and should be part of the deployment, or it does not and the step is misleading.

## Task

- Measure the size difference on all four artifacts
- If it is material, deploy the optimised artifact and make the path the default everywhere, including the deploy config and CI
- If it is immaterial or unsupported for these artifacts, remove the step and say why

## Definition of Done

- `scripts/build.sh` and `scripts/deploy-config.json` agree on which artifact is deployed
- No artifact is produced and then ignored

## Relevant files

- `scripts/build.sh`
- `scripts/deploy-config.json`
