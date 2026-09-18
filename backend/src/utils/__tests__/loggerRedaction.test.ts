import { withRedaction } from '../logger.js';

const redact = (info: Record<string, unknown>): Record<string, unknown> =>
  withRedaction().transform(info as never) as unknown as Record<string, unknown>;

describe('logger credential redaction', () => {
  it('redacts top-level credential fields', () => {
    const output = redact({
      level: 'info',
      message: 'request received',
      authorization: 'Bearer super-secret-token',
      apiKey: 'live-key-123',
      password: 'hunter2',
    });

    expect(output.authorization).toBe('[REDACTED]');
    expect(output.apiKey).toBe('[REDACTED]');
    expect(output.password).toBe('[REDACTED]');
  });

  it('redacts credentials nested inside objects and arrays', () => {
    const output = redact({
      level: 'info',
      message: 'transaction rejected',
      request: {
        headers: { authorization: 'Bearer abc', 'x-api-key': 'k' },
        body: { signedTxXdr: 'AAAA...', amount: 10 },
      },
      attempts: [{ refreshToken: 'r1' }, { refreshToken: 'r2' }],
    });

    const request = output.request as Record<string, Record<string, unknown>>;
    expect(request.headers?.authorization).toBe('[REDACTED]');
    expect(request.headers?.['x-api-key']).toBe('[REDACTED]');
    expect(request.body?.signedTxXdr).toBe('[REDACTED]');
    expect(request.body?.amount).toBe(10);

    const attempts = output.attempts as Array<Record<string, unknown>>;
    expect(attempts[0]?.refreshToken).toBe('[REDACTED]');
    expect(attempts[1]?.refreshToken).toBe('[REDACTED]');
  });

  it('leaves non-sensitive metadata and the message untouched', () => {
    const output = redact({
      level: 'info',
      message: 'loan created',
      requestId: 'req-1',
      loanId: 42,
      statusCode: 201,
    });

    expect(output.message).toBe('loan created');
    expect(output.requestId).toBe('req-1');
    expect(output.loanId).toBe(42);
    expect(output.statusCode).toBe(201);
  });

  it('handles circular references without throwing', () => {
    const circular: Record<string, unknown> = { name: 'root' };
    circular.self = circular;

    const output = redact({ level: 'info', message: 'circular', payload: circular });
    const payload = output.payload as Record<string, unknown>;

    expect(payload.name).toBe('root');
    expect(payload.self).toBe('[Circular]');
  });

  it('serializes Error metadata to name/message/stack', () => {
    const output = redact({ level: 'error', message: 'boom', err: new Error('kaboom') });
    const err = output.err as Record<string, unknown>;

    expect(err.name).toBe('Error');
    expect(err.message).toBe('kaboom');
    expect(err).toHaveProperty('stack');
  });
});
