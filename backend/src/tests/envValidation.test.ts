import { validateEnvVars } from '../config/env.js';
import { jest } from '@jest/globals';

jest.mock('../utils/logger.js');

/** Every variable the validator treats as mandatory. */
const REQUIRED: Record<string, string> = {
  DATABASE_URL: 'postgres://localhost',
  JWT_SECRET: 'secret',
  STELLAR_RPC_URL: 'http://localhost',
  STELLAR_NETWORK_PASSPHRASE: 'test',
  LOAN_MANAGER_CONTRACT_ID: 'C1',
  LENDING_POOL_CONTRACT_ID: 'C2',
  POOL_TOKEN_ADDRESS: 'T1',
  LOAN_MANAGER_ADMIN_SECRET: 'S1',
  INTERNAL_API_KEY: 'K1',
  FRONTEND_URL: 'http://localhost:3000',
  SCORE_DELTA_REPAY: '15',
  SCORE_DELTA_DEFAULT: '50',
  SCORE_DELTA_LATE: '5',
  REMITTANCE_NFT_CONTRACT_ID: 'C3',
  MULTISIG_GOVERNANCE_CONTRACT_ID: 'C4',
};

describe('Environment Variable Validation', () => {
  const originalEnv = process.env;
  let mockExit: ReturnType<typeof jest.spyOn>;

  const setRequired = () => {
    Object.assign(process.env, REQUIRED);
  };

  beforeAll(() => {
    mockExit = jest
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`Process.exit called with ${code}`);
      });
  });

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    mockExit.mockRestore();
  });

  it('should not exit if all required variables are present', () => {
    setRequired();
    process.env.REDIS_URL = 'redis://localhost';

    expect(() => validateEnvVars()).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();
  });

  // REDIS_URL is optional: without it the cache and rate limiter fall back to
  // the in-process store, which is a supported deployment.
  it('should accept a configuration without REDIS_URL', () => {
    setRequired();
    delete process.env.REDIS_URL;
    delete process.env.CACHE_DRIVER;

    expect(() => validateEnvVars()).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should exit with code 1 if a required variable is missing', () => {
    setRequired();
    delete process.env.DATABASE_URL;

    expect(() => validateEnvVars()).toThrow('Process.exit called with 1');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with code 1 if a required variable is empty string', () => {
    setRequired();
    process.env.DATABASE_URL = '   ';

    expect(() => validateEnvVars()).toThrow('Process.exit called with 1');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should reject a REDIS_URL that is not a redis:// URL', () => {
    setRequired();
    process.env.REDIS_URL = 'postgres://nope';

    expect(() => validateEnvVars()).toThrow('Process.exit called with 1');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should reject an unknown CACHE_DRIVER', () => {
    setRequired();
    process.env.CACHE_DRIVER = 'memcached';

    expect(() => validateEnvVars()).toThrow('Process.exit called with 1');
  });

  it('should reject CACHE_DRIVER=redis without a REDIS_URL', () => {
    setRequired();
    process.env.CACHE_DRIVER = 'redis';
    delete process.env.REDIS_URL;

    expect(() => validateEnvVars()).toThrow('Process.exit called with 1');
  });

  it('should accept an explicit memory driver', () => {
    setRequired();
    process.env.CACHE_DRIVER = 'memory';

    expect(() => validateEnvVars()).not.toThrow();
  });
});
