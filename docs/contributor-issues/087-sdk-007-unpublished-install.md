---
title: "SDK: the README's install command does not correspond to a published package"
area: sdk
difficulty: beginner
labels: ["bug", "documentation", "sdk"]
---

## Context

The README opens with `npm install @zizalend/sdk @zizalend/types`. Neither package is published: there is no release workflow that publishes to a registry, and `packages/sdk/package.json` depends on `@zizalend/types` as `"*"`, a version specifier that only resolves inside the npm workspace. A reader who follows the documented first step gets a 404, and the README gives no alternative, so the fastest path to a working setup is the one that fails.

This is the first thing a potential user or reviewer tries. A quick start that does not work is worse than no quick start, because it reads as a claim the project cannot support.

## Task

- Decide the distribution model: publish to a registry, or document the workspace and git-dependency setup
- If publishing, add a release workflow that publishes both packages with a real version relationship between them and a provenance attestation
- If not publishing, replace the install section with the actual steps and say plainly that the packages are consumed from the repository
- Verify the documented commands from a clean directory

## Definition of Done

- Every command in the Installation section works from a clean environment
- `@zizalend/types` is depended on by a version that resolves outside the workspace, or the setup explains why it does not need to

## Relevant files

- `packages/sdk/README.md`
- `packages/sdk/package.json`
- `.github/workflows/`
