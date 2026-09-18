---
title: "Fix the e2e job condition, which tests nothing on pull requests"
area: frontend
difficulty: beginner
labels: ["bug", "frontend", "github_actions", "good first issue", "help wanted"]
---

## Context

The `e2e` job in `ci.yml` is gated on `contains(github.event.pull_request.changed_files, 'frontend/')`. `changed_files` is not a field of the pull request payload — it is a count on the API response, not present on the event — so the expression evaluates against nothing. The practical effect is that end-to-end tests run on pushes to main but not on the pull requests that change the frontend.

## Task

- Replace the condition with a path filter, the same approach the `migration-paths` job already uses
- Confirm the job runs on a frontend-changing pull request and is skipped otherwise
- Remove the now-unnecessary `contains` check from the `if` expression

## Definition of Done

- The e2e job runs when frontend files change in a pull request
- The job is correctly skipped when they do not

## Relevant files

- `.github/workflows/ci.yml`
