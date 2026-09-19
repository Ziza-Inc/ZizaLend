import { Client } from '../client.js';
import { Auth, TOKEN_EXPIRY_SKEW_MS, readTokenExpiryMs } from '../auth.js';

/**
 * Build a JWT-shaped string with the given claims. The signature is not real: nothing in the
 * SDK verifies it, and the backend is the only thing entitled to.
 */
function makeJwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.not-a-real-signature`;
}

function createMockClient() {
  const mockFetch = jest.fn();
  global.fetch = mockFetch;
  const client = new Client({ baseUrl: 'http://localhost:3001/api/v1' });
  return { client, mockFetch };
}

function mockJsonResponse(mockFetch: jest.Mock, data: unknown, status = 200) {
  mockFetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });
}

describe('Auth', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── requestChallenge ────────────────────────────────────────────────────────

  describe('requestChallenge', () => {
    it('requests a challenge for a public key', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);

      mockJsonResponse(mockFetch, {
        success: true,
        data: {
          message: 'Sign this message to authenticate with Zizalend...',
          nonce: 'abc123',
          timestamp: 1700000000000,
          expiresIn: 300000,
        },
      });

      const challenge = await auth.requestChallenge('GABCDEF123');

      expect(challenge.message).toContain('Sign this message');
      expect(challenge.nonce).toBe('abc123');
      expect(challenge.timestamp).toBe(1700000000000);
      expect(challenge.expiresIn).toBe(300000);

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/auth/challenge');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body as string)).toEqual({ publicKey: 'GABCDEF123' });
    });

    it('throws ApiError on failure', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);

      mockJsonResponse(mockFetch, {
        success: false,
        error: { code: 'INVALID_PUBLIC_KEY', message: 'Invalid public key' },
      }, 400);

      await expect(auth.requestChallenge('bad-key')).rejects.toThrow('Invalid public key');
    });
  });

  // ─── login ───────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('submits signed challenge and returns token', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);

      mockJsonResponse(mockFetch, {
        success: true,
        data: { token: 'jwt-token-123', publicKey: 'GABCDEF123' },
      });

      const result = await auth.login('GABCDEF123', 'message', 'base64sig==');

      expect(result.token).toBe('jwt-token-123');
      expect(result.publicKey).toBe('GABCDEF123');

      // Token should be set on the client
      expect(client.hasToken()).toBe(true);

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/auth/login');
      expect(JSON.parse(opts.body as string)).toEqual({
        publicKey: 'GABCDEF123',
        message: 'message',
        signature: 'base64sig==',
      });
    });

    it('sets token on client upon successful login', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);

      expect(client.hasToken()).toBe(false);

      mockJsonResponse(mockFetch, {
        success: true,
        data: { token: 'token-456', publicKey: 'GXYZ' },
      });

      await auth.login('GXYZ', 'msg', 'sig');
      expect(client.hasToken()).toBe(true);
    });
  });

  // ─── verify ──────────────────────────────────────────────────────────────────

  describe('verify', () => {
    it('returns verify data on valid token', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);

      client.setToken('valid-token');

      mockJsonResponse(mockFetch, {
        success: true,
        data: { valid: true, publicKey: 'GABC', role: 'borrower', scopes: ['read:loans'] },
      });

      const result = await auth.verify();

      expect(result.valid).toBe(true);
      expect(result.publicKey).toBe('GABC');
      expect(result.role).toBe('borrower');

      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/auth/verify');
      expect(opts.method).toBe('GET');
    });

    it('returns valid: false for expired token', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);

      client.setToken('expired-token');

      mockJsonResponse(mockFetch, {
        success: true,
        data: { valid: false },
      });

      const result = await auth.verify();
      expect(result.valid).toBe(false);
    });
  });

  // ─── logout ──────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('clears token on successful logout', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);

      client.setToken('some-token');
      expect(client.hasToken()).toBe(true);

      mockJsonResponse(mockFetch, { success: true });

      await auth.logout();
      expect(client.hasToken()).toBe(false);
    });

    it('clears token even if logout request fails', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);

      client.setToken('some-token');
      mockFetch.mockRejectedValue(new Error('Network error'));

      await auth.logout();
      expect(client.hasToken()).toBe(false);
    });

    it('clears token even if server returns error', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);

      client.setToken('some-token');
      mockJsonResponse(mockFetch, {
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Expired' },
      }, 401);

      await auth.logout();
      expect(client.hasToken()).toBe(false);
    });
  });

  // ─── authenticate ────────────────────────────────────────────────────────────

  describe('authenticate', () => {
    it('performs full challenge-sign-login flow', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);

      // First call: challenge
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            message: 'Sign this: nonce=abc123',
            nonce: 'abc123',
            timestamp: 1700000000000,
            expiresIn: 300000,
          },
        }),
      });

      // Second call: login
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { token: 'jwt-final', publicKey: 'GABCDEF123' },
        }),
      });

      const signer = jest.fn().mockResolvedValue('signed-base64');

      const result = await auth.authenticate('GABCDEF123', signer);

      expect(result.token).toBe('jwt-final');
      expect(client.hasToken()).toBe(true);
      expect(signer).toHaveBeenCalledWith('Sign this: nonce=abc123');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws if challenge fails', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: { code: 'INVALID_PUBLIC_KEY', message: 'Bad key' },
        }),
      });

      const signer = jest.fn();
      await expect(auth.authenticate('bad-key', signer)).rejects.toThrow('Bad key');
      expect(signer).not.toHaveBeenCalled();
    });
  });

  // ─── isAuthenticated ─────────────────────────────────────────────────────────

  describe('isAuthenticated', () => {
    it('returns false when no token is set', () => {
      const { client } = createMockClient();
      const auth = new Auth(client);
      expect(auth.hasToken()).toBe(false);
      expect(auth.isAuthenticated()).toBe(false);
    });

    it('returns true for a token that has not expired', () => {
      const { client } = createMockClient();
      const auth = new Auth(client);
      client.setToken(makeJwt({ sub: 'GABC', exp: Math.floor(Date.now() / 1000) + 3600 }));

      expect(auth.hasToken()).toBe(true);
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('returns false for an expired token, while still reporting that one is set', () => {
      const { client } = createMockClient();
      const auth = new Auth(client);
      client.setToken(makeJwt({ sub: 'GABC', exp: Math.floor(Date.now() / 1000) - 60 }));

      // The token is there — this is the distinction `hasToken()` exists to draw...
      expect(auth.hasToken()).toBe(true);
      // ...and it is not usable, which is what `isAuthenticated()` has to answer.
      expect(auth.isAuthenticated()).toBe(false);
    });

    it('agrees with verify() about an expired token', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);
      client.setToken(makeJwt({ sub: 'GABC', exp: Math.floor(Date.now() / 1000) - 60 }));

      mockJsonResponse(mockFetch, { success: true, data: { valid: false } });

      expect(auth.isAuthenticated()).toBe(false);
      await expect(auth.verify()).resolves.toEqual({ valid: false });
    });

    it('treats a token inside the clock-skew margin as expired', () => {
      const { client } = createMockClient();
      const auth = new Auth(client);
      const nowSeconds = Math.floor(Date.now() / 1000);

      // Ten seconds of life is inside the margin: the request this token would authorise could
      // leave just before it lapses.
      client.setToken(makeJwt({ exp: nowSeconds + 10 }));
      expect(auth.isAuthenticated()).toBe(false);

      // An hour of life is comfortably outside it.
      client.setToken(makeJwt({ exp: nowSeconds + 3600 }));
      expect(auth.isAuthenticated()).toBe(true);

      expect(TOKEN_EXPIRY_SKEW_MS).toBeGreaterThan(10_000);
    });

    it('treats a token without an exp claim as present but unverifiable', () => {
      const { client } = createMockClient();
      const auth = new Auth(client);
      client.setToken(makeJwt({ sub: 'GABC' }));

      expect(auth.getTokenExpiresAt()).toBeNull();
      // The client cannot prove it expired, and guessing the other way would sign out callers
      // whose server issues opaque tokens.
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('treats a non-JWT token as present, and reports no expiry', () => {
      const { client } = createMockClient();
      const auth = new Auth(client);
      client.setToken('opaque-token');

      expect(auth.hasToken()).toBe(true);
      expect(auth.getTokenExpiresAt()).toBeNull();
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('returns false after logout', async () => {
      const { client, mockFetch } = createMockClient();
      const auth = new Auth(client);
      client.setToken(makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }));
      mockJsonResponse(mockFetch, { success: true });
      await auth.logout();
      expect(auth.isAuthenticated()).toBe(false);
    });
  });

  // ─── getTokenExpiresAt ───────────────────────────────────────────────────────

  describe('getTokenExpiresAt', () => {
    it('returns null without a token', () => {
      const { client } = createMockClient();
      expect(new Auth(client).getTokenExpiresAt()).toBeNull();
    });

    it('returns the moment the exp claim names', () => {
      const { client } = createMockClient();
      const auth = new Auth(client);
      const exp = Math.floor(Date.now() / 1000) + 1800;
      client.setToken(makeJwt({ exp }));

      expect(auth.getTokenExpiresAt()?.getTime()).toBe(exp * 1000);
    });
  });

  // ─── readTokenExpiryMs ───────────────────────────────────────────────────────

  describe('readTokenExpiryMs', () => {
    it('reads a numeric exp claim from all three JWT segments', () => {
      expect(readTokenExpiryMs(makeJwt({ exp: 1_900_000_000 }))).toBe(1_900_000_000_000);
    });

    it('refuses anything that is not a three-segment JWT', () => {
      expect(readTokenExpiryMs('not-a-jwt')).toBeNull();
      expect(readTokenExpiryMs('a.b')).toBeNull();
      expect(readTokenExpiryMs('a.b.c.d')).toBeNull();
      expect(readTokenExpiryMs('')).toBeNull();
    });

    it('refuses a payload that is not JSON', () => {
      expect(readTokenExpiryMs('header.bm90LWpzb24.signature')).toBeNull();
    });

    it('refuses a payload with no numeric exp', () => {
      expect(readTokenExpiryMs(makeJwt({ sub: 'GABC' }))).toBeNull();
      expect(readTokenExpiryMs(makeJwt({ exp: 'soon' }))).toBeNull();
    });

    it('reads a payload with no base64url padding, as JWTs have none', () => {
      const token = makeJwt({ exp: 1_700_000_000, pad: 'x' });
      // Base64url omits padding, and `atob` rejects a length that is not a multiple of four,
      // so this is exactly the case the decoder has to repair.
      expect(token.split('.')[1]?.endsWith('=')).toBe(false);
      expect(readTokenExpiryMs(token)).toBe(1_700_000_000_000);
    });
  });
});
