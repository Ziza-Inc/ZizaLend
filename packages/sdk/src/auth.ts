/**
 * Authentication module.
 *
 * Implements the Stellar wallet challenge/verify/login flow:
 * 1. Request a challenge message for the wallet
 * 2. User signs the challenge with their Stellar keypair
 * 3. Submit signed challenge to receive a JWT
 * 4. Use JWT for authenticated requests
 */

import { Client, ApiError } from './client.js';

export interface ChallengeMessage {
  message: string;
  nonce: string;
  timestamp: number;
  expiresIn: number;
}

export interface ChallengeResponse {
  success: boolean;
  data: ChallengeMessage;
}

export interface LoginData {
  token: string;
  publicKey: string;
}

export interface LoginResponse {
  success: boolean;
  data: LoginData;
}

export interface VerifyData {
  valid: boolean;
  publicKey?: string | null;
  role?: 'admin' | 'borrower' | 'lender' | null;
  scopes?: string[];
}

export interface VerifyResponse {
  success: boolean;
  data: VerifyData;
}

/**
 * Clock-skew margin applied when deciding whether a token is still usable.
 *
 * A token with less than this much life left is treated as expired. The alternative is a
 * request that leaves just before the token lapses and comes back a 401 the caller had no way
 * to anticipate, which is the failure this margin exists to avoid.
 */
export const TOKEN_EXPIRY_SKEW_MS = 30_000;

/**
 * Read the `exp` claim out of a JWT and return it as a millisecond timestamp.
 *
 * Returns `null` when the token is not a JWT or carries no numeric `exp`. That distinction —
 * "no expiry we can read" versus "expired" — is what the callers need, so it is not collapsed
 * into a boolean here.
 *
 * Works in a browser and in Node alike: `atob` and `TextDecoder` are global in both, so this
 * adds no dependency and no Node-only `Buffer` usage to a package the frontend bundles.
 */
export function readTokenExpiryMs(token: string): number | null {
  const segments = token.split('.');
  if (segments.length !== 3) return null;

  const payload = segments[1];
  if (!payload) return null;

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    // `atob` rejects a length that is not a multiple of four, and JWT payloads are unpadded.
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { exp?: unknown };

    if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;
    return claims.exp * 1000;
  } catch {
    return null;
  }
}

export class Auth {
  constructor(private client: Client) {}

  /**
   * Request a challenge message to sign with your Stellar wallet.
   * @param publicKey - Stellar public key (G...)
   */
  async requestChallenge(publicKey: string): Promise<ChallengeMessage> {
    const response = await this.client.post<ChallengeResponse>('/auth/challenge', {
      publicKey,
    });
    return response.data;
  }

  /**
   * Login by submitting a signed challenge message.
   * On success, the JWT token is automatically set on the client.
   * @param publicKey - Stellar public key
   * @param message - The original challenge message that was signed
   * @param signature - Base64-encoded Ed25519 signature
   * @returns LoginData containing the JWT and public key
   */
  async login(
    publicKey: string,
    message: string,
    signature: string,
  ): Promise<LoginData> {
    const response = await this.client.post<LoginResponse>('/auth/login', {
      publicKey,
      message,
      signature,
    });

    this.client.setToken(response.data.token);
    return response.data;
  }

  /**
   * Verify the current JWT token is still valid.
   */
  async verify(): Promise<VerifyData> {
    const response = await this.client.get<VerifyResponse>('/auth/verify');
    return response.data;
  }

  /**
   * Logout and revoke the current JWT token.
   */
  async logout(): Promise<void> {
    try {
      await this.client.post('/auth/logout');
    } catch (error) {
      // Even if the token is already expired, clear it client-side
    } finally {
      this.client.setToken(undefined);
    }
  }

  /**
   * Full authentication flow:
   * 1. Request challenge
   * 2. Sign with wallet (caller provides signed message)
   * 3. Login with signed challenge
   *
   * @param publicKey - Stellar public key
   * @param signer - Async function that signs a message and returns base64 signature
   * @returns LoginData with JWT
   */
  async authenticate(
    publicKey: string,
    signer: (message: string) => Promise<string>,
  ): Promise<LoginData> {
    const challenge = await this.requestChallenge(publicKey);
    const signature = await signer(challenge.message);
    return this.login(publicKey, challenge.message, signature);
  }

  /**
   * Whether a token is currently set.
   *
   * This says nothing about whether the token is still valid — a caller asking "could this
   * token still authorise a request?" wants `isAuthenticated()`.
   */
  hasToken(): boolean {
    return this.client.hasToken();
  }

  /**
   * The moment the current token expires, or `null` when there is no token or its `exp` claim
   * cannot be read locally. Authoritative for nothing: the server decides.
   */
  getTokenExpiresAt(): Date | null {
    const token = this.client.getToken();
    if (!token) return null;

    const expiresAtMs = readTokenExpiryMs(token);
    return expiresAtMs === null ? null : new Date(expiresAtMs);
  }

  /**
   * Whether the client holds a token that is still usable.
   *
   * This used to answer "is a token set?", which is a different question with a visible
   * consequence: `verify()` reported `valid: false` for an expired token while this method
   * reported `true` for the same token, so a restored session rendered a signed-in shell whose
   * every request failed with a 401, and the user was bounced to a login screen only after the
   * first failure. An expired token now reports `false` here.
   *
   * A token whose `exp` cannot be read — not a JWT, or a JWT without an `exp` claim — reports
   * `true` when one is set. The client cannot prove such a token has expired, and guessing the
   * other way would sign out callers whose server issues opaque tokens. `verify()` remains the
   * authoritative answer for those.
   */
  isAuthenticated(): boolean {
    const token = this.client.getToken();
    if (!token) return false;

    const expiresAtMs = readTokenExpiryMs(token);
    if (expiresAtMs === null) return true;

    return expiresAtMs - TOKEN_EXPIRY_SKEW_MS > Date.now();
  }
}
