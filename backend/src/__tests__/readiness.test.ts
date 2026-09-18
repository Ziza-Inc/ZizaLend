import { jest } from '@jest/globals';
import request from 'supertest';

const queryMock = jest.fn<() => Promise<{ rows: unknown[]; rowCount: number }>>(async () => ({
  rows: [],
  rowCount: 0,
}));

const pingMock = jest.fn<() => Promise<'ok' | 'error'>>(async () => 'ok');

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: queryMock },
  query: queryMock,
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: { ping: pingMock },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn(async () => 'ok'),
    healthCheck: jest.fn(async () => ({ connected: true, latestLedger: 1 })),
  },
}));

const { default: app } = await import('../app.js');

describe('GET /ready', () => {
  beforeEach(() => {
    queryMock.mockClear();
    pingMock.mockReset();
  });

  it('reports ready when the database and cache are reachable', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    pingMock.mockResolvedValueOnce('ok');

    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ready',
      checks: { database: true, redis: true },
    });
  });

  it('reports not ready with 503 when the cache is down', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    pingMock.mockResolvedValueOnce('error');

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('not_ready');
    expect(response.body.checks).toEqual({ database: true, redis: false });
  });

  it('reports not ready with 503 when the database is down', async () => {
    queryMock.mockRejectedValueOnce(new Error('connection refused'));
    pingMock.mockResolvedValueOnce('ok');

    const response = await request(app).get('/ready');

    expect(response.status).toBe(503);
    expect(response.body.checks.database).toBe(false);
  });
});
