/**
 * Unit tests for the scope an idempotency record is keyed under.
 *
 * The scope is what makes an `Idempotency-Key` the caller's own: two callers that resolve to the
 * same scope can be served each other's stored response, so which header is read — and what counts
 * as absent — is asserted here rather than left to the middleware tests' end-to-end check.
 */

import { credentialScope, presentedCredential } from '../middleware/idempotencyPolicy.js';

describe('presentedCredential', () => {
  it('prefers authorization over an API key when a request carries both', () => {
    expect(presentedCredential({ authorization: 'Bearer jwt', 'x-api-key': 'key-1' })).toBe(
      'Bearer jwt',
    );
  });

  it('falls back to the API key when there is no authorization header', () => {
    expect(presentedCredential({ 'x-api-key': 'key-1' })).toBe('key-1');
  });

  it('treats an empty header as no credential at all', () => {
    expect(presentedCredential({ authorization: '' })).toBeUndefined();
    expect(presentedCredential({ 'x-api-key': '' })).toBeUndefined();
  });

  it('reports no credential for a request with neither header', () => {
    expect(presentedCredential({ host: 'localhost' })).toBeUndefined();
  });

  it('joins a repeated header the way the HTTP parser would, so the scope matches the request', () => {
    expect(presentedCredential({ 'x-api-key': ['one', 'two'] })).toBe('one, two');
  });
});

describe('credentialScope', () => {
  it('is opaque: the credential does not appear in the scope', () => {
    const scope = credentialScope('Bearer token-a');

    expect(scope).toMatch(/^c:[0-9a-f]{16}$/);
    expect(scope).not.toContain('token-a');
  });

  it('is stable for one credential and different for another', () => {
    expect(credentialScope('Bearer token-a')).toBe(credentialScope('Bearer token-a'));
    expect(credentialScope('Bearer token-a')).not.toBe(credentialScope('Bearer token-b'));
  });

  it('separates an unauthenticated caller from every credential', () => {
    expect(credentialScope(undefined)).toBe('anonymous');
  });
});
