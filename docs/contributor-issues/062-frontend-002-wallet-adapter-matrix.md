---
title: "Test the wallet connection flow against each supported wallet"
area: frontend
difficulty: intermediate
labels: ["frontend", "testing"]
---

## Context

Wallet connection is the first thing every user does and the most common place a dApp loses them. Behaviour differs per wallet: whether it is installed, whether it is locked, whether the user rejects the signature, whether the network passphrase matches, and whether it reconnects on reload.

## Task

- Enumerate supported wallets and the states each can be in
- Add a test per wallet covering rejected connection, rejected signature, wrong network, and reconnect after reload
- Ensure a wallet on the wrong network produces an actionable message naming the expected network

## Definition of Done

- Each supported wallet is covered by at least one automated test
- A wrong-network connection is refused with a message naming the network

## Relevant files

- `frontend/src/app/components/wallet/`
- `frontend/src/app/config/`
