import { jest } from '@jest/globals';
import request from 'supertest';

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) },
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    ping: jest.fn(async () => 'ok'),
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn(async () => 'ok'),
    healthCheck: jest.fn(async () => ({ connected: true, latestLedger: 1 })),
  },
}));

const { default: app } = await import('../app.js');

describe('Cache-Control on API responses', () => {
  it('marks API responses as no-store', async () => {
    const response = await request(app).get('/api/v1/nonexistent-resource');

    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('marks the user profile namespace as no-store', async () => {
    const response = await request(app).get('/user/nonexistent');

    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('leaves infrastructure endpoints cacheable', async () => {
    const response = await request(app).get('/version');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).not.toBe('no-store');
  });
});
