---
title: "Show the user exactly what they are signing before the wallet prompt"
area: frontend
difficulty: advanced
labels: ["frontend", "security", "ux"]
---

## Context

A user approves a transaction in their wallet, where the wallet shows the XDR or a best-effort summary. The app is better placed to explain the consequence: the amount, the interest, the term, the contract being called. Without that, the wallet prompt is the only safety barrier, and it is a weak one.

## Task

- Present a plain-language summary of the operation before opening the wallet
- Include the target contract address and a link to it on a block explorer
- Refuse to sign when the simulated result does not match what the user was shown (the preview-drift check)
- Add tests asserting the summary is rendered for each transaction type

## Definition of Done

- Every signing path renders a summary naming the contract and the amounts
- A mismatch between preview and simulation blocks the confirmation

## Relevant files

- `frontend/src/app/components/transaction/`
- `frontend/src/app/utils/soroban.ts`
