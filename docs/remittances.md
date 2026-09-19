# Remittance acceptance rules

A remittance record is not just a payment: `remittances` is part of the history that feeds the
credit score, so a value that should not have been accepted is a value that can move a credit
decision. The rules below are therefore enforced at the request boundary **and** again in
`remittanceService.createRemittance`, which is the last line before a row is written and is
reachable without going through a schema.

The shared definitions live in
[`backend/src/services/remittanceRules.ts`](../backend/src/services/remittanceRules.ts); the
boundary copies are in
[`backend/src/schemas/remittanceSchemas.ts`](../backend/src/schemas/remittanceSchemas.ts).

Every rule raises a code of its own so a client can branch and choose the copy, rather than
parsing a message out of a generic `VALIDATION_ERROR`.

| # | Rule | Code | Field | Enforced at the boundary |
|---:|---|---|---|---|
| 1 | The sender address is a well-formed Stellar public key | `INVALID_PUBLIC_KEY` | `senderAddress` | — (authenticated, not submitted) |
| 2 | The recipient address is a well-formed Stellar public key | `INVALID_PUBLIC_KEY` | `recipientAddress` | yes |
| 3 | The recipient is not the sender | `SELF_TRANSFER` | `recipientAddress` | — (needs both addresses) |
| 4 | The amount is a finite number | `INVALID_AMOUNT` | `amount` | yes |
| 5 | The amount is greater than zero | `INVALID_AMOUNT` | `amount` | yes |
| 6 | The amount is at most `REMITTANCE_MAX_AMOUNT` (1,000,000) | `INVALID_AMOUNT` | `amount` | yes |
| 7 | The amount carries at most `REMITTANCE_AMOUNT_DECIMALS` (7) decimal places | `INVALID_AMOUNT` | `amount` | yes |
| 8 | The memo is at most `REMITTANCE_MEMO_MAX_LENGTH` (28) characters | `VALIDATION_ERROR` | `memo` | yes |
| 9 | No identical remittance was recorded for this sender inside the window | `DUPLICATE_REMITTANCE` | `recipientAddress` | — (needs the database) |

## Why each rule is here

**1–2. Address shape.** 56 characters, an ed25519 `G` prefix, base32. Shape only: whether the
account exists, and whether it can hold the asset being sent, is answered by the network when
the transaction is submitted, and guessing at it here would reject valid destinations that have
not been funded yet.

**3. Self-transfer.** Both addresses are well-formed; the request is wrong for what it says,
not for how it is spelled. That is why it is not reported as `INVALID_PUBLIC_KEY`, and why the
client gets copy that says what actually happened. It can only be checked in the service,
because the sender comes from the JWT and never appears in the body.

**4–5. Positive and finite.** `NaN` and `Infinity` survive a `typeof` check and a JSON parse, so
they are rejected explicitly rather than left to become a database error.

**6. Maximum amount.** One million, in the transfer currency. Above this the pool cannot fund
through the loan policy, so accepting the record creates a pending remittance that must fail
later — the worst moment to find out.

**7. Precision.** One stroop is a ten-millionth, so anything finer cannot be represented on the
ledger. Truncating silently would record an amount the ledger never saw, and the score is
computed from these rows. The comparison carries a small tolerance because decimal amounts are
binary fractions: an exact check would reject `0.1 + 0.2` and `1.005 * 100` as imprecise.

**8. Memo length.** Stellar's `MEMO_TEXT` allows 28 bytes. This is the one rule that reuses
`VALIDATION_ERROR` rather than a code of its own: it is a bound on an optional free-text field
and carries no domain meaning, so `field: "memo"` is the whole message the client needs.

**9. Duplicate window.** One minute, keyed on sender, recipient, amount and both currencies. Two
identical records are two credit events, which is why this is a refusal and not a warning. It is
a `409` rather than a `400`: the record was well-formed and acceptable the first time, so it is
the repeat that conflicts, and a caller can tell "retry of something that worked" apart from
"payload that was never valid". Checked before the Soroban RPC call that builds the XDR, so a
duplicate costs one indexed read rather than a round-trip to the network.

A caller that wants to send the same amount to the same recipient twice within the window on
purpose should set an `Idempotency-Key` and change nothing else only if it is genuinely the same
intent; otherwise wait out the window or change the amount or the recipient.

## Related

- [Error codes](./ERROR_CODES.md) — the generated registry, including the two codes this
  document relies on.
- [API idempotency](./wiki/api-idempotency.md) — the separate mechanism for replaying a request
  that was interrupted, keyed by the client rather than by the payload.
