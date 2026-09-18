import request from 'supertest';
import app from '../app.js';
import logger from '../utils/logger.js';
import { jest } from '@jest/globals';

import express from 'express';
import { MAX_REQUEST_ID_LENGTH, requestIdMiddleware } from '../middleware/requestId.js';

describe('Request ID middleware', () => {
  it('adds x-request-id when missing', async () => {
    const response = await request(app).get('/');
    const requestId = response.headers['x-request-id'] as string | undefined;

    expect(response.status).toBe(200);
    expect(requestId).toBeDefined();
    expect(typeof requestId).toBe('string');
    expect((requestId ?? '').length).toBeGreaterThan(0);
  });

  it('preserves client x-request-id', async () => {
    const requestId = 'test-request-id-123';

    const response = await request(app).get('/').set('x-request-id', requestId);

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe(requestId);
  });

  // Header values are asserted through the middleware directly: Node's HTTP
  // client refuses to transmit control characters, so the sanitizer is the
  // component that must reject them.
  const runMiddleware = (incoming: string) => {
    const request = {
      header: () => incoming,
      requestId: undefined as string | undefined,
    };
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
    };

    requestIdMiddleware(request as never, response as never, (() => undefined) as never);

    return { requestId: request.requestId ?? '', header: headers['x-request-id'] ?? '' };
  };

  it('replaces a header containing control characters to prevent log injection', () => {
    const { requestId, header } = runMiddleware('abc\nwarn: forged log line');

    expect(requestId).not.toContain('\n');
    expect(requestId).not.toContain('forged');
    expect(header).toBe(requestId);
  });

  it('replaces an oversized header rather than echoing it back', () => {
    const { requestId } = runMiddleware('a'.repeat(MAX_REQUEST_ID_LENGTH + 50));

    expect(requestId.length).toBeLessThanOrEqual(MAX_REQUEST_ID_LENGTH);
    expect(requestId).not.toBe('a'.repeat(MAX_REQUEST_ID_LENGTH + 50));
  });

  it('falls back to a generated id when the header is blank', () => {
    const { requestId } = runMiddleware('   ');

    expect(requestId.trim().length).toBeGreaterThan(0);
  });

  it('correlates logger requestId with x-request-id via withContext', async () => {
    const tempApp = express();
    tempApp.use(requestIdMiddleware);
    tempApp.get('/test', (_req, res) => {
      logger.withContext().info('Testing withContext correlation');
      res.sendStatus(200);
    });

    const infoSpy = jest
      .spyOn(logger, 'info')
      .mockImplementation(() => logger as unknown as ReturnType<typeof logger.info>);

    const response = await request(tempApp).get('/test');
    const requestId = response.headers['x-request-id'];

    expect(response.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledWith(
      'Testing withContext correlation',
      expect.objectContaining({ requestId }),
    );

    infoSpy.mockRestore();
  });
});
