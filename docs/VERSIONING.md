# Versioning and Compatibility Policy

Covers the two published-shaped workspace packages:

| Package | Version | Consumed by |
| --- | --- | --- |
| [`@zizalend/types`](../packages/types/README.md) | `1.0.0` | `@zizalend/sdk`, and directly by code that needs the raw OpenAPI types |
| [`@zizalend/sdk`](../packages/sdk/README.md) | `1.0.0` | The frontend and backend in this repository |

## Are they published?

**No.** Neither package exists on a public registry:

- There is no release workflow. None of the workflows in
  [`.github/workflows/`](../.github/workflows/) run `npm publish`, and none is
  configured with a registry token.
- `packages/sdk/package.json` depends on `@zizalend/types` with the specifier
  `"*"`, which resolves only inside this npm workspace. On a registry, `"*"`
  would resolve to whatever version happened to be latest, which is not a
  relationship either package can promise.
- Both packages carry `"publishConfig": { "access": "public" }`. That is
  preparation for a release, not evidence of one.

So `npm install @zizalend/sdk` returns a 404. If you arrived here from a README
that told you otherwise, that README was wrong and has been corrected — see
[`packages/sdk/README.md`](../packages/sdk/README.md).

## How to consume them

**From a clone, which is the supported path today.**

```bash
git clone https://github.com/Ziza-Inc/ZizaLend.git
cd ZizaLend
npm install                                              # installs both workspaces
npm run build --workspace packages/types --workspace packages/sdk
```

Inside the repository, imports resolve through the workspace, so
`import { Zizalend } from "@zizalend/sdk"` works from `frontend/` or `backend/`
with no further setup. Order matters on a cold clone:
`@zizalend/types` is generated from `packages/openapi.json`, and
`@zizalend/sdk` is compiled against those generated types, so build `types`
first. The root `npm run build` does this for you.

**From outside the repository: not supported yet.** There is no registry entry to
install from, and a git dependency would not resolve
`@zizalend/types: "*"`. Publishing is the prerequisite, and it needs a release
workflow that publishes both packages with a real version relationship between
them and a provenance attestation. Until that exists, treat the packages as
repository-internal.

## What counts as a breaking change

Semantic Versioning applies per package, but "breaking" is narrower than "the
types changed" for `@zizalend/types` — it is generated output, and it moves every
time the spec does.

### `@zizalend/sdk`

A **major** bump is warranted by:

- Removing or renaming an exported symbol — a class, method, module accessor,
  option, or type alias.
- Making a required parameter optional, or an optional one required.
- Widening a method's return type in a way that breaks exhaustive handling.
- Adding a member to a closed union that consumers must handle exhaustively —
  including `ApiError.errorCode`, whose union is generated from the backend's
  registry. Adding a code there is a `@zizalend/types` change that surfaces as an
  SDK type change, and a `switch` with no default stops compiling.
- Changing retry, timeout or idempotency behaviour such that a call that used to
  issue one request can now issue two, or vice versa.

A **minor** bump covers new methods, new optional options, and new modules.

A **patch** bump covers bug fixes that do not change any of the above.

### `@zizalend/types`

`src/generated.ts` is not committed — it is produced from `packages/openapi.json`
on every build. What consumers depend on is therefore the **spec**, and the
version tracks the API surface rather than the generated file:

- **Major** — a removed path, a removed schema, a removed or renamed property, or
  a type narrowed in a way that rejects payloads the previous version accepted.
- **Minor** — a new path, a new optional property, a new schema.
- **Patch** — a description, example or formatting change with no effect on the
  types.

Because the file is regenerated from the spec, a change here is always a change
to `packages/openapi.json` and should be reviewed there. The `packages` CI job
regenerates and typechecks against the committed spec, so a spec change that does
not compile fails before review.

## How versions move

1. **One version per package, bumped together when they ship together.**
   `@zizalend/sdk` and `@zizalend/types` are released in step, driven by the
   highest bump either of them needs.
2. **The SDK pins the types package exactly** once published — `"@zizalend/types":
   "1.2.0"`, not `"^1.2.0"`. The SDK is compiled against the generated types of
   the spec it was built from; a caret range would let an install resolve a types
   version the SDK was never compiled against, which turns a type error into a
   runtime one.
3. **`"*"` is a workspace-only specifier and must be replaced before the first
   publish.** It is on the list of things the release workflow has to fix, not a
   version relationship to preserve.
4. **A version is never reused.** A published version is immutable; a fix ships
   as a new patch.

## What a consumer should pin

| Consumer | Pin |
| --- | --- |
| The frontend and backend in this repository | Nothing — they consume the workspace, where the version is not part of the resolution |
| A project installing the SDK once it is published | `"@zizalend/sdk": "1.0.0"` — an exact version, or `"~1.0.0"` if you want patches |
| A project using the raw types directly | The same version as the SDK you pin, so the two agree |

Pinning `^` on the SDK is reasonable once the packages are published and the
policy above is honoured: the major version is the compatibility boundary, and
that is what a caret range protects.

## Compatibility in this repository

The packages are consumed internally, so the compatibility surface that matters
in practice is the one CI enforces:

- The `packages` job regenerates `@zizalend/types` from the committed spec and
  typechecks both packages, so a spec change that breaks the SDK fails on the
  pull request rather than in a consumer.
- `node scripts/generate-sdk-error-codes.mjs --check` fails when
  `backend/src/errors/errorCodes.ts` and the SDK's generated union disagree, which
  is what keeps a new error code from reaching the SDK without a type.
- The SDK typechecks against the workspace types package, which is the same
  relationship a pinned dependency would give a consumer.

## What has to happen before the first publish

Recorded here so the policy answers "can I install this?" with a definite no
rather than an unsatisfying maybe:

1. A release workflow that publishes both packages with `--provenance`, from a
   tag, with an npm token scoped to the package namespace.
2. `@zizalend/types` pinned to an exact version in the SDK's dependencies,
   replacing `"*"`.
3. A decision on whether `@zizalend/types` is published at all, or inlined into
   the SDK's build with `bundledDependencies` so consumers install one package.
