import { Client } from '../client.js';
import { Health } from '../health.js';
import { User } from '../user.js';
import { Loans } from '../loans.js';
import { Pool } from '../pool.js';
import { Scores } from '../scores.js';
import { Notifications } from '../notifications.js';
import { Remittances } from '../remittances.js';
import { Transactions } from '../transactions.js';
import { Events } from '../events.js';
import { Indexer } from '../indexer.js';
import { Admin } from '../admin.js';
import { Simulation } from '../simulation.js';

// ─── Test Helper ──────────────────────────────────────────────────────────────

function createMockClient(): { client: Client; mockFetch: jest.Mock } {
  const mockFetch = jest.fn();
  global.fetch = mockFetch;
  const client = new Client({ baseUrl: 'http://localhost:3001/api/v1', token: 'test-token' });
  return { client, mockFetch };
}

function mockSuccess(mockFetch: jest.Mock, data: unknown) {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => data,
  });
}

// ─── Health ───────────────────────────────────────────────────────────────────

describe('Health', () => {
  afterEach(() => jest.restoreAllMocks());

  it('check() returns health status', async () => {
    const { client, mockFetch } = createMockClient();
    const health = new Health(client);
    const response = { status: 'ok', checks: { database: 'ok' as const, redis: 'ok' as const, soroban_rpc: 'ok' as const }, uptime: 123, timestamp: Date.now() };
    mockSuccess(mockFetch, response);

    const result = await health.check();
    expect(result.status).toBe('ok');
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/health');
  });

  it('deepCheck() returns deep health status', async () => {
    const { client, mockFetch } = createMockClient();
    const health = new Health(client);
    mockSuccess(mockFetch, { status: 'ok', checks: { db: 'ok', redis: 'ok', stellarRpc: 'ok', indexer: { status: 'ok', lagLedgers: 5 } }, timestamp: Date.now() });

    const result = await health.deepCheck();
    expect(result.checks.db).toBe('ok');
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/health/deep');
  });

  it('getVersion() returns version info', async () => {
    const { client, mockFetch } = createMockClient();
    const health = new Health(client);
    const versionData = { gitSha: 'abc123', builtAt: '2024-01-01', nodeVersion: 'v20', contracts: { loanManager: 'C1', lendingPool: 'C2', remittanceNft: 'C3', multisigGovernance: 'C4' } };
    mockSuccess(mockFetch, versionData);

    const result = await health.getVersion();
    expect(result.gitSha).toBe('abc123');
    expect(result.contracts.loanManager).toBe('C1');
  });
});

// ─── User ─────────────────────────────────────────────────────────────────────

describe('User', () => {
  afterEach(() => jest.restoreAllMocks());

  it('getProfile() returns user profile', async () => {
    const { client, mockFetch } = createMockClient();
    const user = new User(client);
    mockSuccess(mockFetch, { success: true, data: { publicKey: 'GABC', role: 'borrower', createdAt: '2024-01-01' } });

    const profile = await user.getProfile();
    expect(profile.publicKey).toBe('GABC');
    expect(profile.role).toBe('borrower');
  });

  it('updateProfile() sends PATCH with profile data', async () => {
    const { client, mockFetch } = createMockClient();
    const user = new User(client);
    mockSuccess(mockFetch, { success: true, data: { publicKey: 'GABC', displayName: 'Alice', role: 'borrower', createdAt: '2024-01-01' } });

    const result = await user.updateProfile({ displayName: 'Alice' });
    expect(result.displayName).toBe('Alice');
    const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('PATCH');
  });
});

// ─── Loans ────────────────────────────────────────────────────────────────────

describe('Loans', () => {
  afterEach(() => jest.restoreAllMocks());

  it('list() returns loans', async () => {
    const { client, mockFetch } = createMockClient();
    const loans = new Loans(client);
    mockSuccess(mockFetch, { success: true, borrower: 'GABC', loans: [{ loanId: 1, principal: 1000, status: 'active', borrower: 'GABC' }] });

    const result = await loans.list({ status: 'active' });
    expect(result.loans).toHaveLength(1);
    expect(result.loans[0]?.loanId).toBe(1);
  });

  it('get() returns loan details', async () => {
    const { client, mockFetch } = createMockClient();
    const loans = new Loans(client);
    mockSuccess(mockFetch, { success: true, loanId: '42', summary: { principal: 5000, status: 'active', events: [] } });

    const result = await loans.get(42);
    expect(result.loanId).toBe('42');
    expect(result.summary.principal).toBe(5000);
  });

  it('getConfig() returns loan config', async () => {
    const { client, mockFetch } = createMockClient();
    const loans = new Loans(client);
    mockSuccess(mockFetch, { minAmount: '100', maxAmount: '100000', interestRateBps: 500 });

    const result = await loans.getConfig();
    expect(result.minAmount).toBe('100');
  });

  it('buildRequestTx() posts to /loans/request', async () => {
    const { client, mockFetch } = createMockClient();
    const loans = new Loans(client);
    mockSuccess(mockFetch, { success: true, unsignedTxXdr: 'xdr-data', networkPassphrase: 'Test SDF Network ; September 2015' });

    const result = await loans.buildRequestTx({ borrowerPublicKey: 'GABC', amount: '1000' });
    expect(result.unsignedTxXdr).toBe('xdr-data');
    const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ borrowerPublicKey: 'GABC', amount: '1000' });
  });

  it('buildRepayTx() posts with loanId in path', async () => {
    const { client, mockFetch } = createMockClient();
    const loans = new Loans(client);
    mockSuccess(mockFetch, { success: true, loanId: 42, unsignedTxXdr: 'xdr', networkPassphrase: '' });

    await loans.buildRepayTx(42, { borrowerPublicKey: 'GABC', amount: '500' });
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/loans/42/repay');
  });

  it('submitTransaction() posts signed XDR', async () => {
    const { client, mockFetch } = createMockClient();
    const loans = new Loans(client);
    mockSuccess(mockFetch, { success: true, txHash: 'hash123', status: 'SUCCESS' });

    const result = await loans.submitTransaction(42, 'signed-xdr');
    expect(result.txHash).toBe('hash123');
    const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ signedTxXdr: 'signed-xdr' });
  });

  it('buildCancelTx() and other tx builders work', async () => {
    const { client, mockFetch } = createMockClient();
    const loans = new Loans(client);
    mockSuccess(mockFetch, { success: true, unsignedTxXdr: 'xdr', networkPassphrase: '' });

    await loans.buildCancelTx(42);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/loans/42/cancel');
  });

  it('buildRefinanceTx() sends params', async () => {
    const { client, mockFetch } = createMockClient();
    const loans = new Loans(client);
    mockSuccess(mockFetch, { success: true, unsignedTxXdr: 'xdr', networkPassphrase: '' });

    await loans.buildRefinanceTx(42, { newAmount: '2000', newTermLedgers: 30 });
    const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ newAmount: '2000', newTermLedgers: 30 });
  });

  it('contestDefault() posts with optional reason', async () => {
    const { client, mockFetch } = createMockClient();
    const loans = new Loans(client);
    mockSuccess(mockFetch, { success: true });

    await loans.contestDefault(42, 'I already paid');
    const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ reason: 'I already paid' });
  });

  it('buildExtendTx, buildDepositCollateralTx, buildReleaseCollateralTx, buildLiquidateTx all post to loan-specific paths', async () => {
    const { client, mockFetch } = createMockClient();
    const loans = new Loans(client);
    mockSuccess(mockFetch, { success: true, unsignedTxXdr: 'xdr', networkPassphrase: '' });

    await loans.buildExtendTx(42);
    expect(mockFetch.mock.calls[0][0]).toContain('/loans/42/extend');

    await loans.buildDepositCollateralTx(42);
    expect(mockFetch.mock.calls[1][0]).toContain('/loans/42/collateral/deposit');

    await loans.buildReleaseCollateralTx(42);
    expect(mockFetch.mock.calls[2][0]).toContain('/loans/42/collateral/release');

    await loans.buildLiquidateTx(42);
    expect(mockFetch.mock.calls[3][0]).toContain('/loans/42/liquidate');
  });

  it('getAmortizationSchedule() returns data', async () => {
    const { client, mockFetch } = createMockClient();
    const loans = new Loans(client);
    mockSuccess(mockFetch, { schedule: [] });

    const result = await loans.getAmortizationSchedule(42);
    expect(result).toEqual({ schedule: [] });
  });
});

// ─── Pool ─────────────────────────────────────────────────────────────────────

describe('Pool', () => {
  afterEach(() => jest.restoreAllMocks());

  it('getStats() returns pool stats', async () => {
    const { client, mockFetch } = createMockClient();
    const pool = new Pool(client);
    mockSuccess(mockFetch, { success: true, data: { totalDeposits: 100000, totalOutstanding: 50000, utilizationRate: 0.5, apy: 0.08, activeLoansCount: 25 } });

    const stats = await pool.getStats();
    expect(stats.totalDeposits).toBe(100000);
    expect(stats.apy).toBe(0.08);
  });

  it('getPortfolio() returns depositor portfolio', async () => {
    const { client, mockFetch } = createMockClient();
    const pool = new Pool(client);
    mockSuccess(mockFetch, { success: true, data: { address: 'GABC', depositAmount: 5000, sharePercent: 0.05, estimatedYield: 400, apy: 0.08 } });

    const portfolio = await pool.getPortfolio();
    expect(portfolio.address).toBe('GABC');
  });

  it('getSharePrice() returns price data', async () => {
    const { client, mockFetch } = createMockClient();
    const pool = new Pool(client);
    mockSuccess(mockFetch, { success: true, data: { token: 'USDC', price: 1.02, cached: false } });

    const price = await pool.getSharePrice('USDC');
    expect(price.price).toBe(1.02);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('token=USDC');
  });

  it('buildDepositTx() posts deposit params', async () => {
    const { client, mockFetch } = createMockClient();
    const pool = new Pool(client);
    mockSuccess(mockFetch, { success: true, unsignedTxXdr: 'xdr', networkPassphrase: '' });

    await pool.buildDepositTx({ depositorPublicKey: 'GABC', token: 'USDC', amount: '1000' });
    const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ depositorPublicKey: 'GABC', token: 'USDC', amount: '1000' });
  });

  it('buildWithdrawTx(), buildEmergencyWithdrawTx(), submitTransaction() work', async () => {
    const { client, mockFetch } = createMockClient();
    const pool = new Pool(client);
    mockSuccess(mockFetch, { success: true, unsignedTxXdr: 'xdr', networkPassphrase: '' });

    await pool.buildWithdrawTx({ depositorPublicKey: 'GABC', token: 'USDC', amount: '500' });
    expect(mockFetch.mock.calls[0][0]).toContain('/pool/withdraw');

    await pool.buildEmergencyWithdrawTx();
    expect(mockFetch.mock.calls[1][0]).toContain('/pool/emergency-withdraw');

    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, txHash: 'hash', status: 'SUCCESS' }) });
    const result = await pool.submitTransaction('signed-xdr');
    expect(result.txHash).toBe('hash');
  });
});

// ─── Scores ───────────────────────────────────────────────────────────────────

describe('Scores', () => {
  afterEach(() => jest.restoreAllMocks());

  it('get() returns user score', async () => {
    const { client, mockFetch } = createMockClient();
    const scores = new Scores(client);
    mockSuccess(mockFetch, { success: true, userId: 'GABC', score: 750, band: 'Good' });

    const result = await scores.get('GABC');
    expect(result.score).toBe(750);
    expect(result.band).toBe('Good');
  });

  it('getBreakdown() returns detailed breakdown', async () => {
    const { client, mockFetch } = createMockClient();
    const scores = new Scores(client);
    mockSuccess(mockFetch, { success: true, userId: 'GABC', score: 750, band: 'Good', breakdown: { totalLoans: 5, repaidOnTime: 4, repaidLate: 1, defaulted: 0, totalRepaid: 10000, averageRepaymentTime: '30d', longestStreak: 3, currentStreak: 2 }, history: [{ date: '2024-01-01', score: 700, event: 'Repayment' }] });

    const result = await scores.getBreakdown('GABC');
    expect(result.breakdown.totalLoans).toBe(5);
    expect(result.history).toHaveLength(1);
  });

  it('getHistory() extracts data array', async () => {
    const { client, mockFetch } = createMockClient();
    const scores = new Scores(client);
    mockSuccess(mockFetch, { success: true, data: [{ date: '2024-01-01', score: 700, event: 'Repayment' }] });

    const history = await scores.getHistory('GABC');
    expect(history).toHaveLength(1);
    expect(history[0]?.score).toBe(700);
  });

  it('update() posts score update', async () => {
    const { client, mockFetch } = createMockClient();
    const scores = new Scores(client);
    mockSuccess(mockFetch, { success: true, userId: 'GABC', repaymentAmount: 500, onTime: true, oldScore: 700, delta: 10, newScore: 710, band: 'Good' });

    const result = await scores.update('GABC', { repaymentAmount: 500, onTime: true });
    expect(result.delta).toBe(10);
    expect(result.newScore).toBe(710);
  });
});

// ─── Notifications ────────────────────────────────────────────────────────────

describe('Notifications', () => {
  afterEach(() => jest.restoreAllMocks());

  it('list() returns notifications', async () => {
    const { client, mockFetch } = createMockClient();
    const notif = new Notifications(client);
    mockSuccess(mockFetch, { success: true, data: { notifications: [{ id: 1, userId: 'GABC', type: 'loan_approved', title: 'Approved', message: 'Loan approved', read: false, status: 'unread', createdAt: '2024-01-01' }], unreadCount: 1 } });

    const result = await notif.list({ status: 'unread' });
    expect(result.notifications).toHaveLength(1);
    expect(result.unreadCount).toBe(1);
  });

  it('markRead() posts IDs', async () => {
    const { client, mockFetch } = createMockClient();
    const notif = new Notifications(client);
    mockSuccess(mockFetch, { success: true });

    await notif.markRead([1, 2, 3]);
    const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ ids: [1, 2, 3] });
  });

  it('markAllRead() posts to correct endpoint', async () => {
    const { client, mockFetch } = createMockClient();
    const notif = new Notifications(client);
    mockSuccess(mockFetch, { success: true });

    await notif.markAllRead();
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain('/notifications/mark-all-read');
  });

  it('getPreferences() returns preferences', async () => {
    const { client, mockFetch } = createMockClient();
    const notif = new Notifications(client);
    mockSuccess(mockFetch, { success: true, data: { emailEnabled: true, smsEnabled: false, phone: null, perTypeOverrides: {} } });

    const prefs = await notif.getPreferences();
    expect(prefs.emailEnabled).toBe(true);
  });

  it('updatePreferences() sends put', async () => {
    const { client, mockFetch } = createMockClient();
    const notif = new Notifications(client);
    mockSuccess(mockFetch, { success: true, data: { emailEnabled: true, smsEnabled: true, phone: '+14155551234', perTypeOverrides: {} } });

    const result = await notif.updatePreferences({ emailEnabled: true, smsEnabled: true, phone: '+14155551234' });
    expect(result.emailEnabled).toBe(true);
    const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('PUT');
  });
});

// ─── Remittances ──────────────────────────────────────────────────────────────

describe('Remittances', () => {
  afterEach(() => jest.restoreAllMocks());

  it('list() returns paginated remittances', async () => {
    const { client, mockFetch } = createMockClient();
    const remit = new Remittances(client);
    mockSuccess(mockFetch, { success: true, data: [{ id: 1, senderAddress: 'GABC', recipientAddress: 'GXYZ', amount: '500', token: 'USDC', status: 'completed', createdAt: '2024-01-01' }], page_info: { limit: 20, has_previous: false } });

    const result = await remit.list();
    expect(result.data).toHaveLength(1);
    expect(result.page_info.limit).toBe(20);
  });

  it('create() posts remittance input', async () => {
    const { client, mockFetch } = createMockClient();
    const remit = new Remittances(client);
    mockSuccess(mockFetch, { success: true, data: { id: 1, senderAddress: 'GABC', recipientAddress: 'GXYZ', amount: '500', token: 'USDC', status: 'pending', createdAt: '2024-01-01' }, unsignedTxXdr: 'xdr', networkPassphrase: '' });

    const result = await remit.create({ recipientAddress: 'GXYZ', amount: '500', token: 'USDC' });
    // `data` is optional in the spec's `RemittanceResponse` — the schema is shared with the
    // `POST /remittances` response, which does not declare it required — so the type derived from
    // the spec is the one that governs here.
    expect(result.data?.recipientAddress).toBe('GXYZ');
    expect(result.unsignedTxXdr).toBe('xdr');
  });

  it('get() and submitTransaction() work', async () => {
    const { client, mockFetch } = createMockClient();
    const remit = new Remittances(client);

    mockSuccess(mockFetch, { success: true, data: { id: 1, senderAddress: 'GABC', recipientAddress: 'GXYZ', amount: '500', token: 'USDC', status: 'pending', createdAt: '2024-01-01' } });
    await remit.get(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/remittances/1');

    mockSuccess(mockFetch, { success: true, txHash: 'hash', status: 'SUCCESS' });
    const result = await remit.submitTransaction(1, 'signed-xdr');
    expect(result.txHash).toBe('hash');
  });
});

// ─── Transactions ─────────────────────────────────────────────────────────────

describe('Transactions', () => {
  afterEach(() => jest.restoreAllMocks());

  it('list() returns transactions', async () => {
    const { client, mockFetch } = createMockClient();
    const tx = new Transactions(client);
    mockSuccess(mockFetch, { success: true, data: [{ id: 1, type: 'loan_repayment', amount: '500', status: 'completed', createdAt: '2024-01-01' }] });

    const result = await tx.list({ limit: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.type).toBe('loan_repayment');
  });
});

// ─── Events ───────────────────────────────────────────────────────────────────

describe('Events', () => {
  afterEach(() => jest.restoreAllMocks());

  it('getStreamUrl() builds SSE URL', () => {
    const { client } = createMockClient();
    const events = new Events(client);
    const url = events.getStreamUrl('GABC');
    expect(url).toContain('/events/stream');
    expect(url).toContain('borrower=GABC');
  });

  it('getStreamUrl() without borrower omits param', () => {
    const { client } = createMockClient();
    const events = new Events(client);
    const url = events.getStreamUrl();
    expect(url).not.toContain('borrower=');
  });

  it('getStreamStatus() returns connection counts', async () => {
    const { client, mockFetch } = createMockClient();
    const events = new Events(client);
    mockSuccess(mockFetch, { success: true, data: { borrower: 5, admin: 1, total: 6 } });

    const status = await events.getStreamStatus();
    expect(status.total).toBe(6);
  });
});

// ─── Indexer ──────────────────────────────────────────────────────────────────

describe('Indexer', () => {
  afterEach(() => jest.restoreAllMocks());

  it('getStatus() returns indexer state', async () => {
    const { client, mockFetch } = createMockClient();
    const indexer = new Indexer(client);
    mockSuccess(mockFetch, { success: true, data: { lastIndexedLedger: 12345, lastIndexedCursor: null, lastUpdated: '2024-01-01', totalEvents: 500, eventsByType: { LoanRequested: 200 } } });

    const status = await indexer.getStatus();
    expect(status.lastIndexedLedger).toBe(12345);
  });

  it('getBorrowerEvents() returns paginated events', async () => {
    const { client, mockFetch } = createMockClient();
    const indexer = new Indexer(client);
    mockSuccess(mockFetch, { success: true, data: { events: [{ eventId: 'e1', eventType: 'LoanRequested', ledger: 100, ledgerClosedAt: '2024-01-01', txHash: 'hash' }], pagination: { limit: 20, has_next: false } } });

    const result = await indexer.getBorrowerEvents('GABC', { limit: 20 });
    expect(result.events).toHaveLength(1);
  });

  it('getLoanEvents() returns events for a loan', async () => {
    const { client, mockFetch } = createMockClient();
    const indexer = new Indexer(client);
    mockSuccess(mockFetch, { success: true, data: { events: [{ eventId: 'e1', eventType: 'LoanApproved', ledger: 100, ledgerClosedAt: '2024-01-01', txHash: 'hash' }] } });

    const result = await indexer.getLoanEvents(42);
    expect(result.events).toHaveLength(1);
  });

  it('getRecentEvents() returns event list', async () => {
    const { client, mockFetch } = createMockClient();
    const indexer = new Indexer(client);
    mockSuccess(mockFetch, { success: true, data: { events: [{ eventId: 'e1', eventType: 'LoanRequested', ledger: 100, ledgerClosedAt: '2024-01-01', txHash: 'hash' }] } });

    const result = await indexer.getRecentEvents({ limit: 10 });
    expect(result).toHaveLength(1);
  });

  it('reindexRange() posts range', async () => {
    const { client, mockFetch } = createMockClient();
    const indexer = new Indexer(client);
    mockSuccess(mockFetch, { success: true, data: { fromLedger: 100, toLedger: 200, fetchedEvents: 50, insertedEvents: 50, lastProcessedLedger: 200 } });

    const result = await indexer.reindexRange(100, 200);
    expect(result.insertedEvents).toBe(50);
    const [_, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ fromLedger: 100, toLedger: 200 });
  });

  it('runDefaultCheck() returns check result', async () => {
    const { client, mockFetch } = createMockClient();
    const indexer = new Indexer(client);
    mockSuccess(mockFetch, { success: true, data: { runId: 'run-1', currentLedger: 50000, termLedgers: 17280, overdueCount: 5, loansChecked: 5, successfulSubmissions: 3, failedSubmissions: 2, batches: [] } });

    const result = await indexer.runDefaultCheck();
    expect(result.overdueCount).toBe(5);
  });

  it('webhook CRUD operations work', async () => {
    const { client, mockFetch } = createMockClient();
    const indexer = new Indexer(client);

    mockSuccess(mockFetch, { success: true, data: { subscriptions: [{ id: 1, callbackUrl: 'https://hook.example.com', eventTypes: ['LoanRepaid'], isActive: true, createdAt: '2024-01-01', updatedAt: '2024-01-01' }] } });
    const subs = await indexer.listWebhooks();
    expect(subs).toHaveLength(1);

    mockSuccess(mockFetch, { success: true, data: { subscription: { id: 2, callbackUrl: 'https://hook2.example.com', eventTypes: ['LoanApproved'], isActive: true, createdAt: '2024-01-01', updatedAt: '2024-01-01' } } });
    const created = await indexer.createWebhook({ callbackUrl: 'https://hook2.example.com', eventTypes: ['LoanApproved'] });
    expect(created.callbackUrl).toContain('hook2');

    mockSuccess(mockFetch, { success: true, data: { deliveries: [{ id: 1, subscriptionId: 2, eventId: 'e1', eventType: 'LoanApproved', attemptCount: 1 }] } });
    const deliveries = await indexer.getWebhookDeliveries(2);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.subscriptionId).toBe(2);

    mockSuccess(mockFetch, { success: true, message: 'Deleted' });
    await indexer.deleteWebhook(2);
    expect(mockFetch.mock.calls[3][0]).toContain('/indexer/webhooks/2');
    expect(mockFetch.mock.calls[3][1]?.method).toBe('DELETE');
  });
});

// ─── Admin ─────────────────────────────────────────────────────────────────────

describe('Admin', () => {
  afterEach(() => jest.restoreAllMocks());

  it('listAuditLogs() returns audit entries', async () => {
    const { client, mockFetch } = createMockClient();
    const admin = new Admin(client);
    mockSuccess(mockFetch, { success: true, data: [{ id: 1, actor: 'admin', action: 'loan_approved', status: 200, createdAt: '2024-01-01' }] });

    const logs = await admin.listAuditLogs({ limit: 10 });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe('loan_approved');
  });

  it('listLoanDisputes() returns disputes', async () => {
    const { client, mockFetch } = createMockClient();
    const admin = new Admin(client);
    mockSuccess(mockFetch, { success: true, data: [{ id: 1, loanId: 42, borrower: 'GABC', reason: 'Wrongly defaulted', status: 'pending', createdAt: '2024-01-01' }] });

    const disputes = await admin.listLoanDisputes();
    expect(disputes).toHaveLength(1);
  });

  it('getLoanDispute() fetches by ID', async () => {
    const { client, mockFetch } = createMockClient();
    const admin = new Admin(client);
    mockSuccess(mockFetch, { success: true, data: { id: 1, loanId: 42, borrower: 'GABC', reason: 'test', status: 'pending', createdAt: '2024-01-01' } });

    const dispute = await admin.getLoanDispute(1);
    expect(dispute.loanId).toBe(42);
  });
});

// ─── Simulation ───────────────────────────────────────────────────────────────

describe('Simulation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('getRemittanceHistory() returns history', async () => {
    const { client, mockFetch } = createMockClient();
    const sim = new Simulation(client);
    mockSuccess(mockFetch, { userId: 'GABC', score: 750, streak: 3, history: [{ month: '2024-01', amount: 500, status: 'Completed' }] });

    const result = await sim.getRemittanceHistory('GABC');
    expect(result.score).toBe(750);
    expect(result.history).toHaveLength(1);
  });

  it('simulatePayment() posts and returns result', async () => {
    const { client, mockFetch } = createMockClient();
    const sim = new Simulation(client);
    mockSuccess(mockFetch, { success: true, message: 'Score would increase by 10 points', newScore: 760 });

    const result = await sim.simulatePayment({ userId: 'GABC', amount: 500, onTime: true });
    expect(result.newScore).toBe(760);
    expect(result.message).toContain('Score would increase');
  });
});
