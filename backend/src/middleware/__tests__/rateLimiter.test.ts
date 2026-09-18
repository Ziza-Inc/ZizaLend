import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../rateLimiter.js';

describe('rate limiter responses', () => {
  jest.setTimeout(20000);

  it('allows requests under the limit and rejects with a structured 429', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.get('/ping', createRateLimiter(2, 15), (_req, res) => {
      res.json({ success: true });
    });

    const first = await request(app).get('/ping');
    const second = await request(app).get('/ping');
    const third = await request(app).get('/ping');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);

    // Matches the centralized error envelope so clients can map the code to copy.
    expect(third.body).toMatchObject({
      success: false,
      message: 'Too many requests, please try again later.',
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        type: 'RATE_LIMIT',
      },
    });
    expect(third.body.error.retryAfterSeconds).toBe(900);
  });
});
