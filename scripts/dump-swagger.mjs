#!/usr/bin/env node
/**
 * Dump the OpenAPI document: `npm run generate:spec > packages/openapi.json`.
 *
 * This delegates to `backend/src/config/dumpSwagger.ts`, which reads the `@swagger` annotations
 * from the route and controller sources. It used to import `backend/dist/src/config/swagger.js`
 * directly, which could not work for two reasons, and the second is the instructive one:
 *
 *  1. The build compiles with `src` as its root directory, so the output path is
 *     `dist/config/swagger.js` — the `src` segment does not appear.
 *  2. Even with the right path, `tsc` strips comments, and the annotations swagger-jsdoc collects
 *     are comments. The document came out with zero paths.
 *
 * `tsx` is what runs the backend in development, so generating from source needs no new tooling.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const result = spawnSync('npm', ['run', '--silent', 'generate:spec'], {
  cwd: join(root, 'backend'),
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  console.error('Failed to generate the OpenAPI document.');
  process.exit(result.status ?? 1);
}
