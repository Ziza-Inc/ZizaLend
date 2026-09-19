import logger from '../utils/logger.js';

/**
 * List of environment variables required for the application to function.
 * If any of these are missing or empty on startup, the server will exit immediately
 * with a clear error message.
 */
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'STELLAR_RPC_URL',
  'STELLAR_NETWORK_PASSPHRASE',
  'LOAN_MANAGER_CONTRACT_ID',
  'LENDING_POOL_CONTRACT_ID',
  'REMITTANCE_NFT_CONTRACT_ID',
  'MULTISIG_GOVERNANCE_CONTRACT_ID',
  'POOL_TOKEN_ADDRESS',
  'LOAN_MANAGER_ADMIN_SECRET',
  'INTERNAL_API_KEY',
  'FRONTEND_URL',
  'SCORE_DELTA_REPAY',
  'SCORE_DELTA_DEFAULT',
  'SCORE_DELTA_LATE',
];

/**
 * Variables the service runs without. They change behaviour when present, so
 * they are shape-checked rather than required.
 *
 * `REDIS_URL` is the notable one. Without it the cache and rate limiter use the
 * in-process store (see `utils/kvStore.ts`), which is enough to boot and serve
 * reads on a host with no Redis. With it, cache entries and rate-limit counters
 * are shared across instances — which is what a multi-instance deployment wants.
 */
const OPTIONAL_ENV_VARS = ['REDIS_URL', 'CACHE_DRIVER'];

const ALLOWED_CACHE_DRIVERS = ['auto', 'redis', 'memory'];

/**
 * Shape-check the optional variables. Returns one message per problem so a
 * misconfiguration produces a complete report instead of one error per restart.
 */
function findOptionalEnvProblems(): string[] {
  const problems: string[] = [];

  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl && !/^rediss?:\/\//i.test(redisUrl)) {
    problems.push(
      `REDIS_URL must start with redis:// or rediss:// (got "${redisUrl.slice(0, 16)}...")`,
    );
  }

  const cacheDriver = process.env.CACHE_DRIVER?.trim();
  if (cacheDriver && !ALLOWED_CACHE_DRIVERS.includes(cacheDriver.toLowerCase())) {
    problems.push(
      `CACHE_DRIVER must be one of ${ALLOWED_CACHE_DRIVERS.join(', ')} (got "${cacheDriver}")`,
    );
  }

  // Asking for Redis without a URL would silently degrade to a per-process
  // cache, so treat it as a hard configuration error.
  if (cacheDriver?.toLowerCase() === 'redis' && !redisUrl) {
    problems.push('CACHE_DRIVER=redis requires REDIS_URL to be set');
  }

  return problems;
}

/**
 * Validates that all critical environment variables are set and non-empty.
 * Logs a clear error message and halts the process if any requirements are unmet.
 */
export function validateEnvVars(): void {
  // Filter for variables that are either absent OR just whitespace
  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === '',
  );

  const problems = findOptionalEnvProblems();

  if (missing.length > 0 || problems.length > 0) {
    const boldRed = (msg: string) => `\x1b[1;31m${msg}\x1b[0m`;
    const bold = (msg: string) => `\x1b[1m${msg}\x1b[0m`;

    const errorPrefix = boldRed('FATAL ERROR: Environment validation failed');
    const details = [
      ...(missing.length > 0
        ? [`Missing or empty required variables: ${bold(missing.join(', '))}`]
        : []),
      ...problems.map((problem) => `Invalid optional variable: ${bold(problem)}`),
    ].join('\n');

    // Direct console error for immediate visibility during startup failure
    console.error(
      `\n${errorPrefix}\n${details}\nPlease verify these variables in your \x1b[4m.env\x1b[0m file or deployment environment.\n`,
    );

    // Structured log for persistent logs (e.g., Sentry, CloudWatch, etc.)
    logger.error('Environment validation failure', {
      missing,
      problems,
      node_env: process.env.NODE_ENV,
    });

    // Stop execution immediately
    process.exit(1);
  }

  logger.info('Environment variables validated successfully.');
}

export { REQUIRED_ENV_VARS, OPTIONAL_ENV_VARS };
