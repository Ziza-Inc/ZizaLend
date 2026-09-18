---
title: "Add a README to the types package"
area: packages/sdk
difficulty: beginner
labels: ["documentation", "good first issue", "help wanted", "sdk"]
---

## Context

`packages/types` generates TypeScript types from the OpenAPI specification and has no README. A contributor cannot tell whether the generated files are committed on purpose, whether to edit them, or how to regenerate them.

## Task

- Explain what the package contains and that it is generated
- Document the regeneration command and when to run it
- State the rule for hand-edits, if any are permitted

## Definition of Done

- The README answers whether the generated files are editable
- The regeneration command is correct and tested

## Relevant files

- `packages/types/README.md`
