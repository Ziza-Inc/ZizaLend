---
title: "Verify the admin area refuses non-admin users on the server, not only in the UI"
area: frontend
difficulty: advanced
labels: ["frontend", "security"]
---

## Context

An admin section exists under the localised app tree. Hiding a link is not authorisation: if the route renders for any authenticated user, the admin views need every one of their data fetches to be authorised server-side in the backend. The UI guard should be cosmetic.

## Task

- Confirm the backend refuses each admin API call for a non-admin caller, independent of the UI
- Add a test that a non-admin user requesting an admin route gets a refusal rather than data
- Ensure no admin data is delivered in a server-rendered payload to an unauthorised user

## Definition of Done

- Removing the UI guard does not expose admin data
- A test asserts the server-side refusal

## Relevant files

- `frontend/src/app/[locale]/admin/`
- `backend/src/middleware/`
