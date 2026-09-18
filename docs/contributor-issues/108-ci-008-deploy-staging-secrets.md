---
title: "Audit the staging deployment workflow for secret handling and least privilege"
area: ci-cd
difficulty: advanced
labels: ["ci-cd", "github_actions", "security"]
---

## Context

The staging workflow builds and publishes an image with a broad permissions block that includes write access to packages and security events. Whether each permission is needed by the job that declares it, and whether any secret is available to a step that does not need it, should be verified rather than assumed.

## Task

- Give each job only the permissions it uses
- Ensure secrets are scoped to the steps that require them
- Confirm nothing is echoed to the log
- Document the required secrets and how to rotate them

## Definition of Done

- No job declares an unused permission
- Required secrets are documented

## Relevant files

- `.github/workflows/deploy-staging.yml`
