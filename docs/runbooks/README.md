# Runbooks

Operational runbooks for on-call engineers working on the ZizaLend platform.

An operator under pressure should be able to get from a symptom to the right
runbook without knowing what the runbooks are called. That is what the table
below is for: find the symptom you can see, follow the link.

## Index

| Symptom you can see | Runbook | Preconditions | Elevated privileges |
| --- | --- | --- | --- |
| Blocks are not being indexed, `/api/indexer/status` shows a ledger gap, quarantined events are piling up, or the Soroban RPC is unreachable | [Indexer Recovery](indexer-recovery.md) | Backend reachable over HTTP; read access to the application database | **Yes** — an `INTERNAL_API_KEY` carrying the `admin:indexer` scope |
| A change needs to reach staging, images have to be published, a staging deploy failed and must be rolled back, or the staging health checks are failing | [Staging Deployment](staging-deployment.md) | The `STAGING_ENABLED` variable and the four `STAGING_SSH_*` secrets configured on the repository; SSH access to the staging host | **Yes** — repository admin to change variables or secrets; the staging SSH key |
| An `AdminProposed` or `AdminTransferred` event fired and nobody expected it, a signer key is compromised, or governance is unreachable and the contract admin must be rotated | [Governance Admin Rotation](governance-admin-rotation.md) | The current contract admin secret key; access to governance tooling if governance is reachable | **Yes** — the contract admin secret key, or a governance signer quorum |

## How to use these

Each runbook states its preconditions, walks the diagnosis in order, and says
what "fixed" looks like. They are written to be followed in sequence during an
incident rather than read end to end first.

Start from the symptom, not the filename. If two rows look plausible, start with
the one whose precondition you can already satisfy — an unreachable runbook is
not a plan.

## Escalation

Every runbook names the point at which it stops being sufficient. In general:

- **Indexer and API incidents** — escalate by opening a
  [GitHub issue](https://github.com/Ziza-Inc/ZizaLend/issues/new) with the ledger
  range, the relevant status output and redacted log excerpts.
- **Deployment incidents** — roll back first using the procedure in the staging
  runbook, then investigate. Do not debug forward on a broken staging deploy.
- **Governance and admin incidents** — treat an unexpected `AdminTransferred` as
  an active security incident. Use the security policy rather than the public
  issue tracker; see [SECURITY.md](../../SECURITY.md).

## What is not here

This directory covers operating the deployed system. It does not cover:

- **Responding to a vulnerability report** — see [SECURITY.md](../../SECURITY.md)
  for the disclosure process.
- **Making a release** — see [Deployment](../DEVELOPMENT.md#staging-deployment)
  and `.github/workflows/`.
- **Database schema questions** — see [docs/DATABASE.md](../DATABASE.md).
- **Recovering a corrupted or lost database** — no runbook exists yet because no
  point-in-time recovery procedure has been agreed. Treat this as a gap; a restore
  from `pg_dump` is not verified against a real backup.
