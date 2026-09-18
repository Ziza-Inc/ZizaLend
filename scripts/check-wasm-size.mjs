#!/usr/bin/env node
/**
 * Fail when a contract WASM artifact exceeds its size budget.
 *
 * Why size is gated and per-call gas is not
 * -----------------------------------------
 * `benchmark-gas.ts` measures what each operation costs to run, and those figures are
 * published in `docs/GAS.md`. They are deliberately *not* a CI gate: testnet resource cost
 * drifts with ledger load and protocol version, so a threshold on it would fail for reasons
 * the author of a pull request cannot control — and a check that fails for unrelated reasons
 * is a check people learn to ignore.
 *
 * Binary size is the opposite. It is deterministic for a given source tree, and it is the
 * thing a contributor adding an entry point actually controls. Soroban charges for the
 * contract's code size on deploy and on `uploadContractWasm`, so an unnoticed doubling is a
 * real cost, not a style preference.
 *
 * Budgets are set at roughly 15% above the measured size so that ordinary feature work does
 * not trip the check, but an accidental heavyweight dependency or a debug `println!` left in
 * does. Raising a budget is a deliberate act that shows up in review — which is the point.
 *
 * Usage
 * -----
 *   node scripts/check-wasm-size.mjs            # check the release artifacts
 *   node scripts/check-wasm-size.mjs --json     # machine-readable, for CI summaries
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WASM_DIR = path.join(ROOT, 'contracts', 'target', 'wasm32v1-none', 'release');

/**
 * Per-contract budgets in bytes.
 *
 * The commentary records *why* each budget is where it is, so the next person raising one
 * knows what they are trading away.
 */
const BUDGETS = {
    // The largest contract by a wide margin: the whole loan lifecycle, the credit-score
    // policy, and the default pipeline live here.
    loan_manager: 105_000,
    // Identity, score history, and the metadata registry.
    remittance_nft: 60_000,
    // Deposits, shares, yield accounting, and the multi-token market registry.
    lending_pool: 58_000,
    // Timelock, quorum, and proposal state machine. Deliberately small and dependency-free.
    multisig_governance: 38_000,
};

const asJson = process.argv.includes('--json');

function kb(bytes) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
}

async function main() {
    const results = [];
    let failed = false;
    let missing = 0;

    for (const [name, budget] of Object.entries(BUDGETS)) {
        const file = path.join(WASM_DIR, `${name}.wasm`);
        let bytes;
        try {
            bytes = (await fs.stat(file)).size;
        } catch {
            missing += 1;
            results.push({ name, bytes: null, budget, status: 'missing' });
            continue;
        }

        const status = bytes > budget ? 'over' : 'ok';
        if (status === 'over') failed = true;
        results.push({ name, bytes, budget, status });
    }

    if (asJson) {
        console.log(JSON.stringify({ results, failed, missing }, null, 2));
    } else if (missing === Object.keys(BUDGETS).length) {
        // Nothing built yet. A bare "missing" failure here would be misleading: the caller
        // simply has not run a release build. Say so instead of implying a size problem.
        console.error(
            '\n  No release artifacts found in contracts/target/wasm32v1-none/release.\n' +
                '  Build them first:  cd contracts && ./build.sh\n',
        );
        process.exit(1);
    } else {
        console.log('\n  Contract WASM size budgets\n');
        console.log(
            `  ${'contract'.padEnd(22)} ${'size'.padStart(10)} ${'budget'.padStart(10)} ${'used'.padStart(7)}  status`,
        );
        console.log('  ' + '─'.repeat(62));
        for (const r of results) {
            if (r.bytes === null) {
                console.log(`  ${r.name.padEnd(22)} ${'—'.padStart(10)} ${kb(r.budget).padStart(10)} ${'—'.padStart(7)}  not built`);
                continue;
            }
            const used = ((r.bytes / r.budget) * 100).toFixed(1) + '%';
            console.log(
                `  ${r.name.padEnd(22)} ${kb(r.bytes).padStart(10)} ${kb(r.budget).padStart(10)} ${used.padStart(7)}  ${r.status === 'ok' ? 'ok' : 'OVER BUDGET'}`,
            );
        }
        console.log();
    }

    if (failed) {
        const over = results.filter((r) => r.status === 'over');
        if (!asJson) {
            console.error('  Size budget exceeded:\n');
            for (const r of over) {
                console.error(
                    `    ${r.name}: ${kb(r.bytes)} exceeds ${kb(r.budget)} by ${kb(r.bytes - r.budget)}`,
                );
            }
            console.error(
                '\n  Either trim the contract, or raise its budget in scripts/check-wasm-size.mjs.\n' +
                    '  Raising it is a deliberate cost decision, so say why in the commit message.\n',
            );
        }
        process.exit(1);
    }

    if (!asJson) {
        console.log('  All contracts are within their size budget.\n');
    }
}

await main();
