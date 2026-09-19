# @zizalend/types

TypeScript types for the ZizaLend API, generated from the OpenAPI 3.0 specification at
[`packages/openapi.json`](../openapi.json).

> **The generated file is not committed and must not be edited.** `src/generated.ts` is in
> `.gitignore` and is produced from the spec on every build. Editing it changes nothing: the
> next `npm run build` overwrites it, and your edit will not be in the pull request.

## What is in here

| Path | Committed? | Contents |
| --- | --- | --- |
| `src/index.ts` | yes | Re-exports `./generated.js`. The package's public entry point. |
| `src/generated.ts` | **no** — generated, gitignored | Every path, operation, request body, response and schema in the OpenAPI spec, as TypeScript. About 3,000 lines. |
| `../openapi.json` | yes | The spec those types are generated from. This is the file to edit. |

## Regenerating

From the repository root:

```bash
npm run generate -w packages/types
```

Or from inside this package:

```bash
cd packages/types
npm install   # first time only
npm run generate
```

Either form runs `openapi-typescript ../openapi.json -o src/generated.ts`. It takes about
300ms and prints the file it wrote. `npm run build` here runs `generate` first, so a build
never produces a stale `dist/`.

### When to run it

- After any change to `packages/openapi.json`.
- After a change to the routes or schemas it is derived from — see below.
- When `npm run typecheck` in this package reports a type that does not exist. That means the
  spec has moved on and the local `src/generated.ts` predates it.
- You do not need to run it before committing unless you changed the spec. The file is not
  tracked, so there is nothing to commit either way.

## Where `openapi.json` comes from

`packages/openapi.json` is committed, and it is generated too — from the route definitions'
JSDoc annotations, by the backend's Swagger configuration:

```bash
# from the repository root
npm run generate:spec    # node scripts/dump-swagger.mjs > packages/openapi.json
```

So a change that should reach these types normally starts in the backend's route annotations,
then `generate:spec`, then `generate`. Both files are committed, so a reviewer can see the API
surface change in the diff rather than only in generated output.

## Hand-edits

There are none, and there is no mechanism for any. If a type is wrong, fix the spec — or the
route annotation it is derived from — and regenerate. A hand-edit to `src/generated.ts` is
overwritten on the next build, and a hand-edit to the committed `openapi.json` is overwritten
by the next `generate:spec`.

A type you wish existed (a narrower union, a discriminated payload) belongs in the consuming
package rather than in the spec. `@zizalend/sdk` does this for the event records, modelling
them as a discriminated union over the types the API returns — see
[`packages/sdk/src/events.ts`](../sdk/src/events.ts).

## How CI uses this package

The `packages` job in `.github/workflows/ci.yml` installs dependencies, then runs
`npm run generate` before `npm run typecheck` and `npm run build`. A committed spec that no
longer generates types which compile therefore fails CI, instead of being discovered by the
next person who runs a build.

## Consuming it

```ts
import type { paths, components } from "@zizalend/types";

// A response body, by path and method
type Remittance = components["schemas"]["Remittance"];
```

Most consumers should use [`@zizalend/sdk`](../sdk/README.md) instead, which wraps these types
in a typed client with authentication, retries and error handling.

## Versioning

This package is **not published to a registry** and is consumed from this
repository as a workspace package. What counts as a breaking change here is a
change to the committed spec that removes a path, schema or property — not a
change to `src/generated.ts`, which is regenerated on every build. See
[docs/VERSIONING.md](../../docs/VERSIONING.md) for the full policy, including how
the version relates to `@zizalend/sdk`.

## Related

| Package | Description |
| --- | --- |
| `@zizalend/types` | Generated OpenAPI types (this package) |
| `@zizalend/sdk` | Typed API client built on these types |
