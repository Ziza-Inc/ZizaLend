---
title: "Review the metadata URI scheme allowlist against real metadata hosts"
area: contracts
difficulty: beginner
labels: ["contracts", "good first issue", "help wanted"]
---

## Context

`validate_metadata_uri` accepts only an allowlist of schemes (`ALLOWED_METADATA_URI_SCHEMES`) and rejects a scheme with no location. The list was chosen to prevent the UI rendering a `javascript:` link. It is worth confirming the list matches what the frontend actually emits, or a UI change will start failing on-chain.

## Task

- List the schemes the frontend and seed data emit and confirm each is accepted
- Add a test per accepted scheme and per rejected dangerous scheme
- Document why each accepted scheme is safe to render as a link

## Definition of Done

- Every URI the app can produce is accepted
- `javascript:`, `data:`, and a bare scheme are rejected with `InvalidMetadataUri`

## Relevant files

- `contracts/remittance_nft/src/lib.rs`
- `frontend/src/`
