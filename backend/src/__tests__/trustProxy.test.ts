import { jest } from '@jest/globals';

const loadApp = async () => {
  jest.resetModules();

  const mockQuery = jest
    .fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>()
    .mockResolvedValue({ rows: [], rowCount: 0 });

  jest.unstable_mockModule('../db/connection.js', () => ({
    default: { query: mockQuery },
    query: mockQuery,
    getClient: jest.fn(),
    closePool: jest.fn(),
    withTransaction: jest.fn(),
  }));

  jest.unstable_mockModule('../services/cacheService.js', () => ({
    cacheService: {
      ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    },
  }));

  jest.unstable_mockModule('../services/sorobanService.js', () => ({
    sorobanService: {
      ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
      healthCheck: jest.fn(),
    },
  }));

  return (await import('../app.js')).default;
};

describe('trust proxy configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TRUST_PROXY;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('does not trust forwarding headers by default', async () => {
    const app = await loadApp();

    expect(app.get('trust proxy')).toBe(false);
  });

  it('trusts a configured number of proxy hops', async () => {
    process.env.TRUST_PROXY = '1';
    const app = await loadApp();

    expect(app.get('trust proxy')).toBe(1);
  });

  it('passes through non-numeric trust expressions such as loopback', async () => {
    process.env.TRUST_PROXY = 'loopback';
    const app = await loadApp();

    expect(app.get('trust proxy')).toBe('loopback');
  });

  it('treats an explicit false as disabled', async () => {
    process.env.TRUST_PROXY = 'false';
    const app = await loadApp();

    expect(app.get('trust proxy')).toBe(false);
  });
});
