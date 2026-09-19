import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

import { SUPPORTED_WEBHOOK_EVENT_TYPES } from '../services/webhookService.js';
import { EVENT_TYPE_ALIASES } from '../services/eventIndexer.js';

/**
 * Drift guard between the event types this backend indexes and the union the SDK models.
 *
 * `packages/sdk` cannot import backend code, and the backend cannot depend on the SDK, so the
 * two lists are necessarily separate. What keeps them honest is this test: it reads the SDK's
 * source, compares the two, and fails when one side learns a type the other does not know — a
 * type the consumers of `LoanEventRecord` would otherwise meet only at runtime, in a `default`
 * branch, with an `eventType` their code has never heard of.
 *
 * It reads the SDK file rather than importing it because the SDK is TypeScript compiled by its
 * own tsconfig, and a test is not the place to build another package.
 */

/** Walk up from the backend so the test does not depend on where jest was invoked. */
function locateSdkEventsSource(): string {
  let dir = process.cwd();

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, 'packages', 'sdk', 'src', 'events.ts');
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(`Could not find packages/sdk/src/events.ts by walking up from ${process.cwd()}`);
}

const sdkSource = fs.readFileSync(locateSdkEventsSource(), 'utf8');

/** The `CANONICAL_EVENT_TYPES` array literal in the SDK. */
function readSdkCanonicalEventTypes(): string[] {
  const arrayLiteral = /export const CANONICAL_EVENT_TYPES = \[([\s\S]*?)\] as const;/.exec(
    sdkSource,
  );

  if (!arrayLiteral?.[1]) {
    throw new Error('CANONICAL_EVENT_TYPES was not found in packages/sdk/src/events.ts');
  }

  return [...arrayLiteral[1].matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
}

/** The `LEGACY_EVENT_TYPE_ALIASES` object literal in the SDK, as alias → canonical. */
function readSdkLegacyAliases(): Record<string, string> {
  const objectLiteral = /export const LEGACY_EVENT_TYPE_ALIASES[^{]*\{([\s\S]*?)\n\};/.exec(
    sdkSource,
  );

  if (!objectLiteral?.[1]) {
    throw new Error('LEGACY_EVENT_TYPE_ALIASES was not found in packages/sdk/src/events.ts');
  }

  const aliases: Record<string, string> = {};
  for (const match of objectLiteral[1].matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):\s*'([^']+)',/gm)) {
    aliases[match[1] as string] = match[2] as string;
  }

  if (Object.keys(aliases).length === 0) {
    throw new Error('LEGACY_EVENT_TYPE_ALIASES parsed as empty');
  }

  return aliases;
}

const sdkCanonicalTypes = readSdkCanonicalEventTypes();
const sdkLegacyAliases = readSdkLegacyAliases();
const sdkCanonicalSet = new Set(sdkCanonicalTypes);
const sdkAcceptedSet = new Set([...sdkCanonicalTypes, ...Object.keys(sdkLegacyAliases)]);

describe('SDK event type parity', () => {
  it('reads a non-empty canonical list from the SDK', () => {
    expect(sdkCanonicalTypes.length).toBeGreaterThan(40);
    expect(sdkCanonicalSet.size).toBe(sdkCanonicalTypes.length);
  });

  it('can represent every event type the backend indexes', () => {
    const unrepresentable = SUPPORTED_WEBHOOK_EVENT_TYPES.filter(
      (eventType) => !sdkAcceptedSet.has(eventType),
    );

    expect(unrepresentable).toEqual([]);
  });

  it('does not model a type the backend does not index', () => {
    // The other direction: the SDK may not promise a payload for something that never arrives.
    const notIndexed = sdkCanonicalTypes.filter(
      (eventType) => !(SUPPORTED_WEBHOOK_EVENT_TYPES as readonly string[]).includes(eventType),
    );

    expect(notIndexed).toEqual([]);
  });

  it('lists each canonical type exactly once', () => {
    const duplicates = sdkCanonicalTypes.filter(
      (eventType, index) => sdkCanonicalTypes.indexOf(eventType) !== index,
    );

    expect(duplicates).toEqual([]);
  });

  it('keeps the legacy alias table in step with the indexer', () => {
    expect(Object.keys(sdkLegacyAliases).sort()).toEqual(Object.keys(EVENT_TYPE_ALIASES).sort());
  });

  it('maps each legacy alias to the same canonical type the indexer stores', () => {
    for (const [alias, canonical] of Object.entries(EVENT_TYPE_ALIASES)) {
      expect(sdkLegacyAliases[alias]).toBe(canonical);
    }
  });

  it('maps every legacy alias onto a canonical type the SDK models', () => {
    const unmapped = Object.entries(sdkLegacyAliases)
      .filter(([, canonical]) => !sdkCanonicalSet.has(canonical))
      .map(([alias, canonical]) => `${alias} -> ${canonical}`);

    expect(unmapped).toEqual([]);
  });

  it('does not let an alias shadow a canonical name', () => {
    const shadowing = Object.keys(sdkLegacyAliases).filter((alias) => sdkCanonicalSet.has(alias));

    expect(shadowing).toEqual([]);
  });

  it('names every canonical type the backend supports', () => {
    // A succinct failure message: the whole diff in one line, rather than two failing arrays.
    const backendOnly = SUPPORTED_WEBHOOK_EVENT_TYPES.filter(
      (eventType) => !sdkCanonicalSet.has(eventType) && !(eventType in sdkLegacyAliases),
    );
    const sdkOnly = sdkCanonicalTypes.filter(
      (eventType) => !(SUPPORTED_WEBHOOK_EVENT_TYPES as readonly string[]).includes(eventType),
    );

    expect({ backendOnly, sdkOnly }).toEqual({ backendOnly: [], sdkOnly: [] });
  });
});
