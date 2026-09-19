import { Writable } from 'node:stream';
import { jest } from '@jest/globals';
import winston from 'winston';
import {
  REDACTED,
  REDACTION_DESCRIPTIONS,
  isSensitiveField,
  redactForLogging,
  redactString,
} from '../redaction.js';
import logger from '../logger.js';

/**
 * Credentials that appear inside strings are the leak a field-name pass cannot see: a token in a
 * query string, a password in a connection string, a secret seed with no field name at all.
 */

/** A valid-shaped Stellar secret seed (56 characters, `S` + base32). */
const SECRET_SEED = `S${'A'.repeat(55)}`;

const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJwdWJsaWNLZXkiOiJHQkMiLCJyb2xlIjoiYWRtaW4ifQ.c2lnbmF0dXJlLWhlcmU';

describe('redactString', () => {
  it('removes a bearer token', () => {
    const output = redactString('Authorization: Bearer super-secret-token-value');
    expect(output).not.toContain('super-secret-token-value');
  });

  it('removes a JWT wherever it appears', () => {
    expect(redactString(`token is ${JWT} for now`)).not.toContain(JWT);
  });

  it('removes a secret seed that has no field name', () => {
    expect(redactString(`signing with ${SECRET_SEED}`)).not.toContain(SECRET_SEED);
  });

  it('removes a credential from a query string', () => {
    const output = redactString('GET https://api.example.com/loans?api_key=live_abc123&limit=10');
    expect(output).not.toContain('live_abc123');
    // The rest of the URL survives, so the line still says what was called.
    expect(output).toContain('https://api.example.com/loans');
    expect(output).toContain('limit=10');
  });

  it('removes the password from a connection string but keeps the host', () => {
    const output = redactString('connect failed: postgres://pguser:pgpass@localhost:5432/ZizaLend');
    expect(output).not.toContain('pgpass');
    expect(output).toContain('postgres://pguser:');
    expect(output).toContain('localhost:5432/ZizaLend');
  });

  it('removes a credential from a serialised header blob', () => {
    const output = redactString(
      JSON.stringify({ 'x-api-key': 'internal-key-value', accept: '*/*' }),
    );
    expect(output).not.toContain('internal-key-value');
    expect(output).toContain('*/*');
  });

  it('removes a signed transaction XDR, which anyone holding it could submit', () => {
    const xdr = 'AAAAAgAAAABz';
    const output = redactString(`signedTxXdr: ${xdr}envelope`);
    expect(output).not.toContain(`${xdr}envelope`);
  });

  it('leaves an ordinary message alone', () => {
    const message = 'loan 42 created for borrower GABCDEF with amount 100';
    expect(redactString(message)).toBe(message);
  });

  it('leaves a value too short to be a credential alone', () => {
    expect(redactString('a=b')).toBe('a=b');
  });
});

describe('redactForLogging', () => {
  it('redacts by field name at any depth', () => {
    const output = redactForLogging({
      request: {
        headers: { authorization: 'Bearer abc', 'x-api-key': 'k' },
        body: { signedTxXdr: 'AAAA...', amount: 10 },
      },
    }) as Record<string, Record<string, Record<string, unknown>>>;

    expect(output.request?.headers?.authorization).toBe(REDACTED);
    expect(output.request?.headers?.['x-api-key']).toBe(REDACTED);
    expect(output.request?.body?.signedTxXdr).toBe(REDACTED);
    expect(output.request?.body?.amount).toBe(10);
  });

  it('redacts a credential inside a string under a harmless field name', () => {
    const output = redactForLogging({
      url: 'https://rpc.example.com/?token=live_xyz987',
      note: 'no credentials here',
    }) as Record<string, unknown>;

    expect(output.url).not.toContain('live_xyz987');
    expect(output.note).toBe('no credentials here');
  });

  it('redacts a credential inside an exception message and stack', () => {
    const error = new Error(`fetch failed for https://api.example.com/x?api_key=live_leak_1`);
    const output = redactForLogging({ err: error }) as { err: { message: string; stack: string } };

    expect(output.err.message).not.toContain('live_leak_1');
    expect(output.err.stack).not.toContain('live_leak_1');
  });

  it('does not mutate the value it was given', () => {
    const body = { password: 'hunter2', nested: { token: 'abc12345' } };
    redactForLogging(body);

    // Redaction that edited the request in place would corrupt the request as a side effect of
    // logging it.
    expect(body.password).toBe('hunter2');
    expect(body.nested.token).toBe('abc12345');
  });

  it('handles a cyclic request graph', () => {
    const req: Record<string, unknown> = { path: '/api/loans' };
    req.res = { req };

    const output = redactForLogging(req) as Record<string, Record<string, unknown>>;
    expect(output.path).toBe('/api/loans');
    expect(output.res?.req).toBe('[Circular]');
  });

  it('agrees with itself about what a sensitive field is', () => {
    for (const name of ['password', 'refreshToken', 'x-api-key', 'signedTxXdr', 'authorization']) {
      expect(isSensitiveField(name)).toBe(true);
    }
    for (const name of ['loanId', 'requestId', 'statusCode', 'amount', 'publicInfo']) {
      expect(isSensitiveField(name)).toBe(false);
    }
  });

  it('documents every value pattern it applies', () => {
    expect(REDACTION_DESCRIPTIONS.length).toBeGreaterThanOrEqual(5);
    for (const description of REDACTION_DESCRIPTIONS) {
      expect(description).toMatch(/credential|token|password|key|JWT|bearer/i);
    }
  });
});

describe('the logger boundary', () => {
  /**
   * A transport that captures what actually reaches a sink.
   *
   * It deliberately carries no format of its own: redaction has to happen on the way in, not
   * inside the console transport, or a second transport is a second way to leak.
   */
  function capturingTransport(): {
    transport: winston.transport;
    lines: string[];
    dispose: () => void;
  } {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });

    const transport = new winston.transports.Stream({ stream, format: winston.format.json() });
    return { transport, lines, dispose: () => undefined };
  }

  it('keeps a credential out of the serialised log line', () => {
    const { transport, lines } = capturingTransport();
    logger.add(transport);

    try {
      logger.info('request failed', {
        url: 'https://api.example.com/loans?api_key=live_leak_2&limit=1',
        authorization: 'Bearer live_leak_3',
      });
    } finally {
      logger.remove(transport);
    }

    const output = lines.join('\n');
    expect(output).not.toContain('live_leak_2');
    expect(output).not.toContain('live_leak_3');
    expect(output).toContain('request failed');
  });

  it('keeps a credential out of a log message, not just its metadata', () => {
    const { transport, lines } = capturingTransport();
    logger.add(transport);

    try {
      logger.warn(`upstream rejected the request with token=${JWT}`);
    } finally {
      logger.remove(transport);
    }

    expect(lines.join('\n')).not.toContain(JWT);
  });

  it('redacts for a transport added after start-up', () => {
    // The property under test: redaction is on the logger, so a new sink inherits it.
    const first = capturingTransport();
    const second = capturingTransport();
    logger.add(first.transport);
    logger.add(second.transport);

    try {
      logger.error('disbursement failed', { dsn: `postgres://u:leak_4@db:5432/x` });
    } finally {
      logger.remove(first.transport);
      logger.remove(second.transport);
    }

    expect(first.lines.join('\n')).not.toContain('leak_4');
    expect(second.lines.join('\n')).not.toContain('leak_4');
  });
});

// Keeps `jest` imported for the ESM module registry this suite relies on.
void jest;
