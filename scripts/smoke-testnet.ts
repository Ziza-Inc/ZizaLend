/**
 * End-to-end Testnet smoke test.
 *
 * Exercises the protocol the way a real user does, against the deployed contracts,
 * and asserts the outcome of every step. This is the check that a deployment is
 * *functional* rather than merely present: `deploy.ts` proves the contracts exist and
 * are wired, which is not the same claim.
 *
 * Covered:
 *   1. every wiring role reads back as expected
 *   2. lender deposits into the pool, and the deposit is share-backed
 *   3. an immediate withdrawal is refused — the flash-loan guard actually fires
 *   4. the borrower holds a credit NFT and can request a loan against it
 *   5. the admin approves, and the pool disburses the principal
 *   6. the borrower repays in full and the loan reaches `Repaid`
 *   7. repayment credits the borrower's credit score
 *   8. the lender exits through `emergency_withdraw` once the minimum hold elapses
 *
 * Step 3 asserts a *refusal*, which is the stronger claim. The regular `withdraw`
 * path imposes a 1,440-ledger cooldown (~2 hours at 5s ledgers) and no CI run can wait
 * for it, so the test proves the guard is armed instead of proving the happy path is
 * reachable — the happy path is covered exhaustively by the contract test suite.
 *
 * Usage:  SECRET_KEY=<admin secret> npx ts-node smoke-testnet.ts [testnet]
 */
import {
    Address,
    Keypair,
    rpc as Rpc,
    scValToNative,
    xdr,
} from '@stellar/stellar-sdk';
import { createHash } from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { invoke, readContract } from './soroban';
import { i128, u32 } from './scval';

dotenv.config();

const CONFIG_PATH = path.join(__dirname, 'deploy-config.json');
const FRIENDBOT = 'https://friendbot.stellar.org';
const ONE_XLM = 10_000_000n;

/** Thrown for an assertion that failed; keeps the report readable. */
class CheckFailure extends Error {}

/**
 * `LoanStatus` is a `#[contracttype]` enum, so it crosses the boundary as its numeric
 * discriminant rather than as a string. The declared order is the ABI.
 */
const LOAN_STATUS = [
    'Pending',
    'Approved',
    'Repaid',
    'Defaulted',
    'Liquidated',
    'Cancelled',
    'Rejected',
] as const;

const statusName = (value: unknown): string =>
    typeof value === 'number'
        ? (LOAN_STATUS[value] ?? `Unknown(${value})`)
        : String(value);

async function fund(pubkey: string): Promise<void> {
    const response = await fetch(
        `${FRIENDBOT}?addr=${encodeURIComponent(pubkey)}`,
    );
    if (!response.ok) {
        throw new Error(
            `friendbot refused ${pubkey}: ${response.status} ${response.statusText}`,
        );
    }
}

async function main() {
    const network = process.argv[2] || 'testnet';
    const config = (await fs.readJson(CONFIG_PATH))[network];
    if (!config) throw new Error(`No config for network: ${network}`);

    const secretKey = process.env.SECRET_KEY;
    if (!secretKey)
        throw new Error('SECRET_KEY environment variable is required');

    // The deployment manifest, written by `deploy.ts`.
    const manifestPath = path.join(__dirname, 'deployments', `${network}.json`);
    if (!(await fs.pathExists(manifestPath))) {
        throw new Error(
            `No deployment manifest at ${manifestPath}. Run \`npx ts-node deploy.ts ${network}\` first.`,
        );
    }
    const deployment = await fs.readJson(manifestPath);

    const admin = Keypair.fromSecret(secretKey);
    const server = new Rpc.Server(config.rpcUrl, { allowHttp: false });
    const passphrase = config.networkPassphrase;
    const token: string = config.token;

    const {
        remittance_nft: nft,
        lending_pool: pool,
        loan_manager: manager,
    } = deployment.contracts;

    /** Read a value and convert it out of XDR into plain JavaScript. */
    const read = async (
        contractId: string,
        method: string,
        args: unknown[] = [],
    ) =>
        scValToNative(
            await readContract(
                server,
                contractId,
                method,
                args,
                admin,
                passphrase,
            ),
        );

    /** Submit a call and return its return value as plain JavaScript. */
    const call = async (
        contractId: string,
        method: string,
        args: unknown[] = [],
    ) =>
        scValToNative(
            (await invoke(server, contractId, method, args, admin, passphrase))
                .retval,
        );

    const steps: Array<{ name: string; detail: string }> = [];
    const record = (name: string, detail: string) => {
        steps.push({ name, detail });
        console.log(`  ✅ ${name} — ${detail}`);
    };

    const expect = (condition: boolean, message: string) => {
        if (!condition) throw new CheckFailure(message);
    };

    console.log(`\nZizaLend Testnet smoke test → ${network}`);
    console.log(`  rpc   : ${config.rpcUrl}`);
    console.log(`  admin : ${admin.publicKey()}`);
    console.log(`  token : ${token}\n`);

    // ── 1. Wiring ───────────────────────────────────────────────────────────────
    console.log('[1/8] Verifying deployment wiring…');

    expect(
        (await read(pool, 'get_loan_manager')) === manager,
        'pool.loan_manager is not LoanManager',
    );
    expect(
        (await read(nft, 'get_score_recorder')) === manager,
        'nft.score_recorder is not LoanManager',
    );
    expect(
        (await read(pool, 'is_token_allowed', [token])) === true,
        'pool does not allow the token',
    );
    expect(
        (await read(manager, 'get_nft_contract')) === nft,
        'manager.nft_contract mismatch',
    );
    expect(
        (await read(manager, 'get_lending_pool')) === pool,
        'manager.lending_pool mismatch',
    );
    expect(
        Address.fromString(await read(pool, 'get_governance')).toString()
            .length === 56,
        'pool has no governance address',
    );
    record('wiring', 'all roles resolve to the expected addresses');

    const minScore = await read(manager, 'get_min_score');
    const defaultTerm = await read(manager, 'get_default_term');
    const maxLoanAmount = BigInt(await read(manager, 'get_max_loan_amount'));
    expect(
        maxLoanAmount >= BigInt(10) * ONE_XLM,
        `max_loan_amount is only ${maxLoanAmount} stroops`,
    );

    // ── Participants ────────────────────────────────────────────────────────────
    // Fresh random keypairs each run, funded by friendbot. The token is the native XLM
    // Stellar Asset Contract, so a funded account already holds the loan asset.
    const lender = Keypair.random();
    const borrower = Keypair.random();
    console.log('\n  funding lender and borrower via friendbot…');
    await Promise.all([fund(lender.publicKey()), fund(borrower.publicKey())]);
    // Friendbot returns before the ledger closes; the first `getAccount` needs the account.
    await new Promise((resolve) => setTimeout(resolve, 6000));

    const depositAmount = 100n * ONE_XLM;
    const loanAmount = 10n * ONE_XLM;

    const lenderCall = async (method: string, args: unknown[]) =>
        scValToNative(
            (await invoke(server, pool, method, args, lender, passphrase))
                .retval,
        );
    const borrowerCall = async (method: string, args: unknown[]) =>
        scValToNative(
            (await invoke(server, manager, method, args, borrower, passphrase))
                .retval,
        );

    // ── 2. Lender deposits ──────────────────────────────────────────────────────
    console.log('\n[2/8] Lender deposits into the pool…');
    await lenderCall('deposit', [
        lender.publicKey(),
        token,
        i128(depositAmount),
    ]);

    const shares = BigInt(
        await read(pool, 'get_shares', [lender.publicKey(), token]),
    );
    expect(shares > 0n, 'deposit minted no shares');
    expect(
        BigInt(await read(pool, 'get_total_deposits', [token])) >=
            depositAmount,
        'total_deposits did not increase by the deposit',
    );
    record('deposit', `${depositAmount} stroops → ${shares} shares`);

    // ── 3. The withdrawal guard is armed ────────────────────────────────────────
    console.log(
        '\n[3/8] Confirming the withdrawal cooldown refuses an immediate exit…',
    );
    let refused = false;
    try {
        await lenderCall('withdraw', [lender.publicKey(), token, i128(shares)]);
    } catch {
        refused = true;
    }
    expect(
        refused,
        'withdraw succeeded in the deposit ledger: the flash-loan guard is bypassable',
    );
    record('withdrawal guard', 'immediate withdraw refused as designed');

    // ── 4. Borrower receives a credit NFT ───────────────────────────────────────
    console.log('\n[4/8] Minting the borrower credit NFT…');
    const score = Math.max(minScore, 600);
    const historyHash = createHash('sha256')
        .update('ZizaLend:smoke-test')
        .digest();
    await call(nft, 'mint', [
        borrower.publicKey(),
        u32(score),
        historyHash,
        'https://zizalend.example/metadata/smoke-test',
        // `minter: Option<Address>`. `None` is `scvVoid`, and it is the *admin* mint
        // path: the contract treats a provided minter as a request to credit the score
        // as an authorised recorder instead. Omitting the argument entirely fails the
        // call's parameter-length check rather than defaulting.
        xdr.ScVal.scvVoid(),
    ]);
    expect(
        (await read(nft, 'get_score', [borrower.publicKey()])) === score,
        'minted score mismatch',
    );
    record(
        'credit identity',
        `borrower minted with score ${score} (floor ${minScore})`,
    );

    // ── 5. Borrower requests, admin approves ────────────────────────────────────
    console.log('\n[5/8] Requesting and approving a loan…');
    const loanId = Number(
        await borrowerCall('request_loan', [
            borrower.publicKey(),
            i128(loanAmount),
            u32(defaultTerm),
        ]),
    );
    expect(
        Number.isInteger(loanId) && loanId >= 0,
        `request_loan returned ${loanId}`,
    );

    let loan = await read(manager, 'get_loan', [u32(loanId)]);
    expect(
        statusName(loan.status) === 'Pending',
        `loan status after request is ${statusName(loan.status)}`,
    );

    await call(manager, 'approve_loan', [u32(loanId)]);
    loan = await read(manager, 'get_loan', [u32(loanId)]);
    expect(
        statusName(loan.status) === 'Approved',
        `loan status after approval is ${statusName(loan.status)}`,
    );
    expect(
        BigInt(loan.term_ledgers) === BigInt(defaultTerm),
        'approval changed the requested term',
    );
    record(
        'loan approval',
        `loan #${loanId} approved for ${loanAmount} stroops over ${defaultTerm} ledgers`,
    );

    // ── 6. Borrower repays in full ─────────────────────────────────────────────
    console.log('\n[6/8] Repaying the loan…');
    let repayments = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
        loan = await read(manager, 'get_loan_accrued', [u32(loanId)]);
        if (statusName(loan.status) === 'Repaid') break;

        // The contract's `current_total_debt`: remaining principal + accrued interest
        // + accrued late fees. `interest_paid` and `late_fee_paid` are lifetime
        // counters and are deliberately not subtracted -- `repay` already decrements
        // `accrued_interest` by the interest portion of each payment, so subtracting
        // the cumulative total as well understates the debt and leaves a residual
        // that never clears.
        const outstanding =
            BigInt(loan.amount) -
            BigInt(loan.principal_paid) +
            BigInt(loan.accrued_interest) +
            BigInt(loan.accrued_late_fee);
        if (outstanding <= 0n) break;

        console.log(`  paying ${outstanding} stroops of outstanding debt`);
        await borrowerCall('repay', [
            borrower.publicKey(),
            u32(loanId),
            i128(outstanding),
        ]);
        repayments++;
    }

    loan = await read(manager, 'get_loan', [u32(loanId)]);
    expect(
        statusName(loan.status) === 'Repaid',
        `loan did not reach Repaid (status ${statusName(loan.status)})`,
    );
    record(
        'repayment',
        `loan #${loanId} repaid in ${repayments} payment(s), principal+interest settled`,
    );

    // ── 7. Repayment credited the score ────────────────────────────────────────
    console.log('\n[7/8] Confirming the repayment credited the credit score…');
    const scoreAfter = await read(nft, 'get_score', [borrower.publicKey()]);
    expect(
        scoreAfter > score,
        `score did not increase (${score} → ${scoreAfter})`,
    );
    record('score credited', `borrower score ${score} → ${scoreAfter}`);

    // ── 8. Lender exits ────────────────────────────────────────────────────────
    // `emergency_withdraw` skips the cooldown but not the one-ledger minimum hold, so
    // one ledger has to close first. That is the guard doing its job, not an obstacle.
    console.log('\n[8/8] Waiting one ledger, then the lender exits…');
    await new Promise((resolve) => setTimeout(resolve, 6000));
    const remainingShares = BigInt(
        await read(pool, 'get_shares', [lender.publicKey(), token]),
    );
    if (remainingShares > 0n) {
        await lenderCall('emergency_withdraw', [
            lender.publicKey(),
            token,
            i128(remainingShares),
        ]);
    }
    const sharesAfter = BigInt(
        await read(pool, 'get_shares', [lender.publicKey(), token]),
    );
    expect(
        sharesAfter < remainingShares,
        'emergency_withdraw left the share balance unchanged',
    );
    record(
        'withdrawal',
        `lender redeemed ${remainingShares - sharesAfter} of ${shares} shares`,
    );

    console.log(
        '\n──────────────────────────────────────────────────────────────',
    );
    console.log(`Testnet smoke test PASSED — ${steps.length} checks\n`);
    for (const step of steps) {
        console.log(`  ${step.name.padEnd(18)} ${step.detail}`);
    }
    console.log('');
}

main().catch((error) => {
    if (error instanceof CheckFailure) {
        console.error(`\n❌ SMOKE TEST FAILED: ${error.message}`);
    } else if (error instanceof Error) {
        console.error(`\n❌ SMOKE TEST ERRORED: ${error.message}`);
    } else {
        console.error('\n❌ SMOKE TEST ERRORED:', error);
    }
    process.exit(1);
});
