#!/usr/bin/env node
/**
 * Print the OpenAPI document to stdout.
 *
 * Usage: `npm run generate:spec` from `backend/` (write the output to `packages/openapi.json`), or
 * the root `npm run generate:spec`, which delegates here.
 *
 * It lives in `src/config/` beside the configuration it reads, and is excluded from the coverage
 * measurement in `jest.config.ts`: a command-line program that prints a document to stdout has no
 * lines a test can meaningfully exercise.
 *
 * Why this runs from source through `tsx`
 * ---------------------------------------
 * The document is assembled by swagger-jsdoc from the `@swagger` JSDoc blocks on the routes and
 * controllers, and those annotations are *comments*. `tsc` strips comments, so importing the build
 * output produces a document with zero paths — which is what the previous generator did, both by
 * pointing at a `dist/src/...` path the build never emits and by reading the build at all. The
 * net effect was that the published contract could not be regenerated, and it drifted: it
 * described `POST /simulate/payment`, a path no route has served, while the route annotation says
 * `POST /simulate`.
 *
 * The empty-document guard below exists so that failure mode is loud. A generator whose output is
 * silently empty is worse than one that errors, because the empty file gets committed.
 *
 * `swagger.ts` resolves its globs relative to the process working directory, so this must be run
 * from `backend/`.
 */
import { swaggerSpec } from './swagger.js';

// `swagger-jsdoc` types its result as `object`, and the guard below is exactly the check that
// makes the shape worth asserting.
const document = swaggerSpec as { paths?: Record<string, unknown> };
const paths = Object.keys(document.paths ?? {});

if (paths.length === 0) {
  console.error(
    'Refusing to emit an OpenAPI document with no paths.\n' +
      'The annotations live in source comments, so generate from source (run from `backend/`):\n' +
      '  npm run generate:spec\n' +
      'If you are reading the build output, the comments were stripped by tsc and no annotations ' +
      'will be found.',
  );
  process.exit(1);
}

process.stdout.write(`${JSON.stringify(swaggerSpec, null, 2)}\n`);
