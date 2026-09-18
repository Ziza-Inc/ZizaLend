---
title: "SDK: `isAuthenticated` reports true for an expired token"
area: sdk
difficulty: beginner
labels: ["bug", "sdk", "typescript"]
---

## Context

`Auth.isAuthenticated` answers whether a token is *set*, not whether it is *valid*. The distinction is visible in the module itself: `verify()` asks the server and correctly reports `valid: false` for an expired token, while `isAuthenticated()` returns `true` for the same token. The unit test pins the current behaviour — `returns true when a token is set` — so it is deliberate rather than accidental.

Consumers use this method to decide whether to render the authenticated shell. A restored session whose token has expired therefore renders a signed-in interface whose every request fails with 401, and the user is bounced to a login screen only after the first failing call.

## Task

- Either decode the token's expiry claim locally, or have `verify()` populate a cached validity that `isAuthenticated` consults
- Keep the method's name honest: if it only reports presence, name it `hasToken` and add a separate validity check
- Handle the clock-skew margin rather than treating a token expiring in one second as valid
- Update the tests to cover an expired token, a valid token, and no token

## Definition of Done

- A restored session with an expired token does not render an authenticated surface
- The three states are covered by tests
- The method name describes what it actually measures

## Relevant files

- `packages/sdk/src/auth.ts`
- `packages/sdk/src/__tests__/auth.test.ts`
