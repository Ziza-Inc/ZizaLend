# Security Policy

For the authentication and authorization model (roles, scopes, JWT flow,
API-key namespaces, cookie attributes, and route guards) see
[docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md). The contract-side trust model,
including the admin escape hatch, is documented in
[docs/SECURITY-MODEL.md#admin-escape-hatch](docs/SECURITY-MODEL.md#admin-escape-hatch).

## Supported Versions

Only the current `main` branch and the last tagged release are supported with
security updates.

| Version   | Supported          |
| --------- | ------------------ |
| Main      | :white_check_mark: |
| Last Tag  | :white_check_mark: |
| Older     | :x:                |

## Reporting a Vulnerability

**Do not open a public GitHub issue, pull request or discussion for a security
problem.** The issue tracker is public, and a report that names a reachable
vulnerability is a disclosure to everyone who reads it before a fix exists.

Report privately through **GitHub Security Advisories**:

> https://github.com/Ziza-Inc/ZizaLend/security/advisories/new

That channel is private between you and the maintainers, gives you a tracked
thread, and lets us credit you when the advisory is published. If you cannot use
it, email the maintainers listed on the GitHub organisation rather than filing an
issue.

### What to include

* A description of the vulnerability and the impact you believe it has.
* Steps to reproduce, ideally against a local instance or Testnet.
* The affected component (contract, backend, frontend, SDK, deployment) and the
  commit or release you tested.
* Any logs, traces or proof-of-concept output.
* Whether you intend to publish, and on what timeline.

### Scope

**In scope**

| Area | Examples |
| --- | --- |
| Soroban contracts (`contracts/`) | Authorisation bypasses, arithmetic and rounding bugs, storage/TTL misuse, lost or duplicated value, event misreporting |
| Backend API (`backend/`) | Authentication and authorisation flaws, injection, request forgery (SSRF), cross-tenant data access, secret exposure in logs or responses |
| Frontend (`frontend/`) | XSS, client-side authorisation treated as a control, leaked secrets in the bundle, unsafe service-worker caching of private data |
| SDK and packages (`packages/`) | Credential handling, retry behaviour that can duplicate a state change |
| Deployment (`scripts/`, `.github/workflows/`, compose files) | Secret handling, over-privileged tokens, supply-chain weaknesses in the build |

**Out of scope**

* Third-party services, dependencies and infrastructure not managed in this
  repository — report those upstream. A dependency with a published advisory is
  tracked through [Dependabot](.github/dependabot.yml), so a report that only
  restates one is not actionable here.
* Findings that require a compromised operator machine, a malicious browser
  extension, or physical access to a device.
* Denial of service through raw traffic volume with no specific weakness; the API
  has rate limiting and the contracts are metered by the network.
* Missing hardening headers with no demonstrated impact, and automated scanner
  output submitted without a reproduction.
* The accepted limitations listed below — these are known, deliberate trade-offs,
  not vulnerabilities. If you believe one of them is exploitable in a way the
  description does not cover, say so explicitly in your report.

### Response and disclosure

| Stage | Expectation |
| --- | --- |
| Acknowledgement | Within **5 business days** |
| Initial assessment (severity, affected versions, whether it is in scope) | Within **10 business days** of acknowledgement |
| Fix or mitigation for a confirmed high or critical finding | Within **30 days** |
| Fix for a confirmed moderate or low finding | Next scheduled release |
| Coordinated public disclosure | **90 days** after the report, or sooner once a fix is released, whichever comes first |

We will keep you informed if a timeline slips, and we will agree a publication
date with you rather than publishing an advisory without warning. If a fix ships
early we publish early; if a finding is disputed we explain why in writing.

We do not currently run a paid bounty programme. We are glad to credit reporters
in the advisory and in the release notes unless you ask us not to.

### Safe harbour

Good-faith research is welcome. We will not pursue or support legal action
against anyone who reports a vulnerability through the channel above, who does
not access or modify data belonging to another person, who does not degrade the
service for others, and who gives us the disclosure window above before
publishing. Testing against the deployed Testnet instance with your own accounts
is fine; testing against infrastructure you do not own is not.

## Known, Accepted Limitations

Each of these is a deliberate design decision with a stated mitigation. They are
listed so they are not reported repeatedly, and so an operator knows what to
watch.

| Limitation | Why it is accepted | Mitigation |
| --- | --- | --- |
| **The contract admin key can still rotate the admin without governance.** After `set_governance`, `set_admin` accepts only the governance contract's authorisation — but `propose_admin` / `accept_admin` remain available to the current admin as a two-step recovery path if governance is unreachable. | A governance module that cannot be bypassed is a governance module that can permanently brick a contract if its signers lose access. | Monitor `AdminProposed` and `AdminTransferred`; any proposal that did not originate from a governance proposal is an incident. See [the governance runbook](docs/runbooks/governance-admin-rotation.md). |
| **Admin operations authenticate with a shared API key**, not a user JWT. `INTERNAL_API_KEY` is a comma-separated list, optionally scoped per namespace (`admin:disputes:…`). | Admin tooling is server-to-server and has no wallet to sign a challenge with. | Scoped keys limit the blast radius of one credential; rotate the key by adding a new one and removing the old rather than editing in place. |
| **The `lender` role does not hold `write:pool`**, so `build-deposit`, `build-withdraw`, `build-emergency-withdraw` and `submit` return 403 to lenders today. | Documented gap rather than a decision — tracked in [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md) and in the issue tracker. | Tracked as a known gap; the route guards are correct, the role grant is incomplete. |
| **Only Testnet is deployed.** No mainnet contracts, and no real funds are at risk. | The protocol has not been audited. | The deployment registry in [docs/deployed-contracts.md](docs/deployed-contracts.md) records the network for every contract ID. |
| **The contracts have not been independently audited.** | Pre-audit stage. | WASM size budgets, a tarpaulin coverage floor and a fuzz suite run in CI; see the `contracts` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). |
| **Locally seeded data can appear on a deployed instance.** | Useful for demos and review. | Seeded rows are synthetic and documented; do not treat the staging or Testnet deployment as a record of real activity. |

## Threat model summary

The assets worth protecting are: user funds in the lending pool, the integrity of
the on-chain credit score, the admin and governance keys, the JWT signing secret,
the internal API key and the database credentials.

The trust boundaries are: the wallet (holds the user's key and signs
transactions), the backend API (holds all server-side secrets and is the only
writer to the database), the Soroban contracts (hold pooled funds and enforce the
loan state machine), and the deployment pipeline (holds the credentials that reach
production).

A change that moves a decision across one of those boundaries — for example
letting the frontend decide an authorisation outcome, or letting the backend
assume a contract check already ran — is worth a review even when the code is
correct in isolation.
