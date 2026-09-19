import { jest } from '@jest/globals';
import request from 'supertest';

process.env.INTERNAL_API_KEY = 'test-metrics-key';

const queryMock = jest.fn(async () => ({ rows: [], rowCount: 0 }));

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: queryMock },
  query: queryMock,
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: { ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok') },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    getScoreConfig: jest.fn(() => ({ repaymentDelta: 20, defaultPenalty: 50 })),
  },
}));

const { default: app } = await import('../app.js');
const { metricsRegistry } = await import('../middleware/metrics.js');
const {
  HTTP_METHODS,
  KNOWN_STATUS_CODES,
  LABEL_VALIDATORS,
  OTHER,
  STATUS_CLASSES,
  UNMATCHED_ROUTE,
  isTemplateRouteLabel,
  normaliseMethod,
  normaliseRouteLabel,
  normaliseStatusCode,
  statusClassFor,
} = await import('../middleware/metricsLabels.js');

/**
 * A label value that grows with traffic is a series that grows with traffic, and Prometheus holds
 * every series in memory. These tests assert the two halves of the fix: the normalisers collapse
 * resource-shaped values, and the live registry only ever contains values from a declared domain.
 *
 * `metrics.test.ts` covers the metrics' meaning; this file covers their boundedness.
 */

interface Sample {
  metricName: string;
  labels: Record<string, string>;
}

function samplesFrom(
  metrics: Awaited<ReturnType<typeof metricsRegistry.getMetricsAsJSON>>,
): Sample[] {
  const samples: Sample[] = [];

  for (const metric of metrics) {
    for (const value of metric.values ?? []) {
      const labels = (value.labels ?? {}) as Record<string, string>;
      const names = Object.keys(labels);
      if (names.length === 0) continue;
      samples.push({ metricName: metric.name, labels });
    }
  }

  return samples;
}

async function driveTraffic(): Promise<void> {
  await request(app).get('/health');
  // An indexed resource: the identifier must not reach the label.
  await request(app).get('/api/loans/123');
  await request(app).get('/api/v1/loans/987654321');
  await request(app).get('/api/v1/remittances/550e8400-e29b-41d4-a716-446655440000');
  // A Stellar-shaped account segment.
  await request(app).get(
    '/api/v1/score/GDEVUSERALICE000000000000000000000000000000000000000000001',
  );
  // A path that matches nothing: no template exists, so the raw path must not be recorded.
  await request(app).get('/wp-admin/probe-0123456789abcdef0123456789abcdef');
  // A rejected request, to exercise a non-2xx class and code.
  await request(app).get('/metrics');
  await request(app)
    .post('/api/v1/loans/42/repay')
    .set('Idempotency-Key', crypto.randomUUID())
    .send({});
}

describe('label normalisers', () => {
  it.each([
    ['/api/loans/123', '/api/loans/:param'],
    ['/api/v1/loans/987654321/events', '/api/v1/loans/:param/events'],
    ['/api/v1/remittances/550e8400-e29b-41d4-a716-446655440000', '/api/v1/remittances/:param'],
    ['/api/v1/loans/abc123def456abc123def456abc123de', '/api/v1/loans/:param'],
    [
      '/api/v1/score/GDEVUSERALICE000000000000000000000000000000000000000000001',
      '/api/v1/score/:param',
    ],
  ])('collapses the identifier in %p', (input, expected) => {
    expect(normaliseRouteLabel(input)).toBe(expected);
  });

  it.each([
    ['/api/loans/:loanId', '/api/loans/:loanId'],
    ['/api/v1/notifications/mark-read', '/api/v1/notifications/mark-read'],
    ['/health', '/health'],
    ['/api/v1/indexer/status', '/api/v1/indexer/status'],
  ])('leaves the template %p alone', (input, expected) => {
    expect(normaliseRouteLabel(input)).toBe(expected);
  });

  it.each(['', '   ', UNMATCHED_ROUTE])('reports %p as unmatched', (input) => {
    expect(normaliseRouteLabel(input)).toBe(UNMATCHED_ROUTE);
  });

  it('keeps a static root path, which is a single series rather than an open set', () => {
    expect(normaliseRouteLabel('/')).toBe('/');
  });

  it('keeps an already-parameterised mount prefix intact', () => {
    // `req.baseUrl` holds the *matched* prefix, so a router mounted under a parameter carries the
    // substituted value. The id goes; the parameter name stays.
    expect(normaliseRouteLabel('/tenants/42/loans/:loanId')).toBe('/tenants/:param/loans/:loanId');
  });

  it('accepts only templates, so the assertion used below cannot be vacuous', () => {
    expect(isTemplateRouteLabel('/api/v1/loans/:param')).toBe(true);
    expect(isTemplateRouteLabel(UNMATCHED_ROUTE)).toBe(true);
    expect(isTemplateRouteLabel('/api/v1/loans/123')).toBe(false);
    expect(isTemplateRouteLabel('not-a-path')).toBe(false);
  });

  it('bounds the method label', () => {
    expect(normaliseMethod('GET')).toBe('GET');
    expect(normaliseMethod('BREW')).toBe(OTHER);
    expect(normaliseMethod('')).toBe(OTHER);
  });

  it('bounds the status code label to the codes this API emits', () => {
    expect(normaliseStatusCode(200)).toBe('200');
    expect(normaliseStatusCode(429)).toBe('429');
    // 599 is a valid HTTP status in principle, and not one any handler here returns; a series per
    // code the API cannot produce is cardinality bought for nothing.
    expect(normaliseStatusCode(599)).toBe(OTHER);
    expect(normaliseStatusCode(0)).toBe(OTHER);
  });

  it('bounds the status class label', () => {
    expect(statusClassFor(200)).toBe('2xx');
    expect(statusClassFor(404)).toBe('4xx');
    // An unexpected code inside 1xx–5xx still lands in a declared class, which is the point of
    // labelling by class; only codes outside HTTP's range have nowhere to go.
    expect(statusClassFor(599)).toBe('5xx');
    expect(statusClassFor(0)).toBe(OTHER);
    expect(statusClassFor(999)).toBe(OTHER);
  });

  it('declares a validator for every bounded value it produces', () => {
    // `other` and `unmatched` are outputs of the normalisers, so the declared domains have to accept
    // them or the registry audit below would reject this service's own values.
    expect(HTTP_METHODS.has('GET')).toBe(true);
    expect(STATUS_CLASSES.has('4xx')).toBe(true);
    expect(KNOWN_STATUS_CODES.has('429')).toBe(true);
    expect(isTemplateRouteLabel(normaliseRouteLabel('/api/loans/7'))).toBe(true);
  });
});

describe('the metrics registry', () => {
  let samples: Sample[];

  beforeAll(async () => {
    await driveTraffic();
    samples = samplesFrom(await metricsRegistry.getMetricsAsJSON());
  });

  it('has labelled series to check', () => {
    // Without this, every assertion below would pass on an empty registry.
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.map((sample) => sample.metricName)).toContain('http_requests_total');
  });

  it('declares the label domain of every metric that carries labels', () => {
    const undeclared = [
      ...new Set(
        samples
          .filter((sample) => {
            const declared = LABEL_VALIDATORS[sample.metricName];
            return !declared || Object.keys(sample.labels).some((name) => !(name in declared));
          })
          .map((sample) => `${sample.metricName}{${Object.keys(sample.labels).sort().join(',')}}`),
      ),
    ].sort();

    expect(undeclared).toEqual([]);
  });

  it('holds only values from those declared domains', () => {
    const violations: string[] = [];

    for (const { metricName, labels } of samples) {
      const declared = LABEL_VALIDATORS[metricName] ?? {};

      for (const [labelName, value] of Object.entries(labels)) {
        const validator = declared[labelName];
        if (!validator) continue;
        if (!validator(value)) violations.push(`${metricName}{${labelName}="${value}"}`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('records resource paths as templates rather than as the requested URL', () => {
    const routes = samples
      .filter((sample) => sample.metricName === 'http_requests_total')
      .map((sample) => sample.labels.route);

    // The identifier is replaced by the template's parameter name, and the mount prefix survives:
    // without it `/api/loans/:loanId` and `/api/v1/loans/:loanId` would be the same series.
    expect(routes).toEqual(
      expect.arrayContaining([
        '/api/loans/:loanId',
        '/api/v1/loans/:loanId',
        '/api/v1/remittances/:id',
        '/api/v1/score/:userId',
        '/api/v1/loans/:loanId/repay',
        '/health',
        '/metrics',
      ]),
    );
    // 987654321 is the loan id from the traffic above: it must not appear in any label.
    expect(routes.some((route) => route?.includes('987654321'))).toBe(false);
    expect(routes.some((route) => route?.includes('GDEVUSERALICE'))).toBe(false);
  });

  it('records an unmatched path as unmatched, not as the path a scanner asked for', () => {
    const routes = samples.map((sample) => sample.labels.route);

    expect(routes).toContain(UNMATCHED_ROUTE);
    expect(
      routes.some(
        (route) => route?.includes('wp-admin') || route?.includes('probe-0123456789abcdef'),
      ),
    ).toBe(false);
  });

  it('keeps every route label a template across the whole registry', () => {
    const notTemplates = samples
      .map((sample) => sample.labels.route)
      .filter((route): route is string => route !== undefined)
      .filter((route) => !isTemplateRouteLabel(route));

    expect(notTemplates).toEqual([]);
  });
});
