import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Every operation in the spec has an SDK method, and every call the SDK makes is in the spec.
 *
 * `packages/openapi.json` describes the API and this package implements a client for it. Nothing
 * connected the two, so an endpoint added to the backend could go unimplemented here
 * indefinitely — the consumer finds out at runtime — and a renamed path would be a silent 404.
 *
 * The check is textual rather than type-level because the two artifacts are independent: the spec
 * is generated from the backend's swagger config, and the SDK is hand-written apart from its error
 * codes. Reading the calls the SDK actually makes is also what makes the failure meaningful — a
 * method that exists but points at a path the API no longer serves is precisely the drift this is
 * for.
 */

/**
 * The spec and the SDK sources, located by walking up from the working directory.
 *
 * Jest runs this package from `packages/sdk`, but the spec lives at the repo root, and the SDK
 * is meant to be testable from anywhere underneath it. Walking up for a marker keeps the test
 * independent of the current depth without reaching for `import.meta`, which the NodeNext
 * module setting here allows only from an ES module and this file is transformed to CommonJS.
 */
function findRepoRoot(): string {
  for (let directory = process.cwd(); ; ) {
    if (existsSync(path.join(directory, 'packages', 'openapi.json'))) return directory;

    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`could not find packages/openapi.json above ${process.cwd()}`);
    }
    directory = parent;
  }
}

const SDK_SRC = path.join(findRepoRoot(), 'packages', 'sdk', 'src');
const SPEC_PATH = path.join(findRepoRoot(), 'packages', 'openapi.json');

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface OpenApiSpec {
  paths: Record<string, Record<string, unknown>>;
}

/**
 * One SDK call: the verb, then the path, allowing for a generic argument that may span lines.
 *
 * A generic argument is why this cannot be a naive `.get("` search: `client.get<{ success: boolean }>(
 * "/loans/config")` is a call, and `client.delete(`/indexer/webhooks/${id}`)` has no generic at all.
 */
const CALL_PATTERN = /\.(get|post|put|patch|delete)\s*(?:<[\s\S]{0,400}?>)?\s*\(\s*[`'"]([^`'"]+)[`'"]/g;

/**
 * An SSE stream is opened by URL rather than through the client, which is still this package
 * implementing the operation.
 */
const STREAM_PATTERN = /new URL\(\s*`\$\{[^}]*\}([^`$]*)`/g;

/**
 * Reduce a path to its shape: `${loanId}` and `{loanId}` are the same segment.
 *
 * Without this, every templated path would look like drift in both directions — `:id` vs `{id}`,
 * and two different parameter names for the same segment.
 */
function toShape(operation: string): string {
  return operation
    .replace(/\$\{[^}]*\}/g, ':param')
    .replace(/:[A-Za-z0-9_]+/g, ':param')
    .replace(/\{[A-Za-z0-9_]+\}/g, ':param')
    .replace(/\/$/, '');
}

function documentedOperations(): Set<string> {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiSpec;
  const operations = new Set<string>();

  for (const [specPath, methods] of Object.entries(spec.paths)) {
    for (const method of Object.keys(methods)) {
      if (HTTP_METHODS.includes(method as (typeof HTTP_METHODS)[number])) {
        operations.add(toShape(`${method.toUpperCase()} ${specPath}`));
      }
    }
  }

  return operations;
}

function implementedOperations(): Set<string> {
  const operations = new Set<string>();

  for (const file of readdirSync(SDK_SRC)) {
    if (!file.endsWith('.ts') || file.includes('.test.')) continue;

    const source = readFileSync(path.join(SDK_SRC, file), 'utf8');

    for (const match of source.matchAll(CALL_PATTERN)) {
      const route = match[2];
      if (route?.startsWith('/')) operations.add(toShape(`${match[1]!.toUpperCase()} ${route}`));
    }

    for (const match of source.matchAll(STREAM_PATTERN)) {
      const route = match[1];
      if (route?.startsWith('/')) operations.add(toShape(`GET ${route}`));
    }
  }

  return operations;
}

describe('SDK surface against the OpenAPI spec', () => {
  const documented = documentedOperations();
  const implemented = implementedOperations();

  it('reads a spec and a set of calls worth comparing', () => {
    // Guards the test itself: a spec that failed to parse, or a scan that matched nothing, would
    // otherwise pass by comparing two empty sets.
    expect(documented.size).toBeGreaterThan(50);
    expect(implemented.size).toBeGreaterThan(50);
  });

  it('implements every operation the spec documents', () => {
    const missing = [...documented].filter((operation) => !implemented.has(operation)).sort();

    expect(missing).toEqual([]);
  });

  it('documents every operation the SDK calls', () => {
    const undocumented = [...implemented].filter((operation) => !documented.has(operation)).sort();

    expect(undocumented).toEqual([]);
  });

  it('counts the two sets the same way, parameter names included', () => {
    // `toShape` collapses every parameter to `:param`; if it ever stopped doing so, the two
    // comparisons above would fail on a rename rather than on real drift.
    expect(toShape('GET /loans/${loanId}/events')).toBe('GET /loans/:param/events');
    expect(toShape('POST /indexer/webhooks/{subscriptionId}/deliveries')).toBe(
      'POST /indexer/webhooks/:param/deliveries',
    );
  });
});
