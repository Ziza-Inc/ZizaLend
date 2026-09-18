import {
    Keypair,
    Operation,
    TransactionBuilder,
    rpc as Rpc,
    Address,
    StrKey,
    xdr,
} from '@stellar/stellar-sdk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';
import {
    computeWasmHash,
    contractSalt,
    deriveContractId,
    contractInstanceExists,
    contractIdFromRetval,
    extractContractId,
    invoke,
    readContract,
    sendTx,
} from './soroban';
import {
    i128,
    scValToAddress,
    scValToBool,
    scValToI128,
    scValToU32,
    u32,
} from './scval';

dotenv.config();

const CONFIG_PATH = path.join(__dirname, 'deploy-config.json');

// Upload WASM bytecode to the network and return its SHA-256 hash.
// If the same WASM was uploaded before the hash is already indexed, but the
// operation is idempotent and safe to repeat.
async function uploadWasm(
    server: Rpc.Server,
    wasmPath: string,
    account: Keypair,
    networkPassphrase: string,
): Promise<Buffer> {
    const wasm = await fs.readFile(wasmPath);
    const wasmHash = computeWasmHash(wasm);

    console.log(
        `  uploading ${path.basename(wasmPath)} (hash ${wasmHash.toString('hex').slice(0, 12)}…)`,
    );

    const source = await server.getAccount(account.publicKey());
    const tx = new TransactionBuilder(source, {
        fee: '100000',
        networkPassphrase,
    })
        .addOperation(Operation.uploadContractWasm({ wasm }))
        .setTimeout(30)
        .build();

    await sendTx(server, tx, account);
    return wasmHash;
}

// Instantiate a contract from an uploaded WASM hash. Returns the new contract ID.
async function createInstance(
    server: Rpc.Server,
    wasmHash: Buffer,
    salt: Buffer,
    account: Keypair,
    networkPassphrase: string,
): Promise<string> {
    const expectedId = deriveContractId(account, salt, networkPassphrase);

    if (await contractInstanceExists(server, expectedId)) {
        console.log(`    already deployed at ${expectedId}, skipping create`);
        return expectedId;
    }

    const source = await server.getAccount(account.publicKey());
    const tx = new TransactionBuilder(source, {
        fee: '100000',
        networkPassphrase,
    })
        .addOperation(
            Operation.createCustomContract({
                address: Address.fromString(account.publicKey()),
                wasmHash,
                salt,
            }),
        )
        .setTimeout(30)
        .build();

    const outcome = await sendTx(server, tx, account);

    const contractId =
        contractIdFromRetval(outcome.retval) ??
        extractContractId(outcome.response.resultMetaXdr);

    if (!contractId) {
        throw new Error(
            'Could not determine the new contract ID: the create-contract host function ' +
                'returned no address and the transaction metadata carried no ' +
                'scvLedgerKeyContractInstance entry.',
        );
    }

    // The derivation and the host must agree. A mismatch means the salt, the source
    // account, or the network passphrase is not what this script believes it is, and
    // every address written to the .env files afterwards would be wrong.
    if (contractId !== expectedId) {
        throw new Error(
            `Contract address mismatch: derived ${expectedId} but the host created ${contractId}`,
        );
    }

    return contractId;
}

async function main() {
    const network = process.argv[2] || 'testnet';
    const config = (await fs.readJson(CONFIG_PATH))[network];
    if (!config) throw new Error(`No config for network: ${network}`);

    const secretKey = process.env.SECRET_KEY;
    if (!secretKey)
        throw new Error('SECRET_KEY environment variable is required');

    const account = Keypair.fromSecret(secretKey);
    // Fall back to the deployer's own key when admin is not set in config.
    const adminAddr =
        config.admin === 'YOUR_ADMIN_PUBLIC_KEY'
            ? account.publicKey()
            : config.admin;

    const server = new Rpc.Server(config.rpcUrl);
    const passphrase = config.networkPassphrase;

    // Fail before uploading anything.
    //
    // A malformed `token` is the most expensive configuration mistake to discover,
    // because `LendingPool.allow_token` and `LoanManager.initialize` are both reached
    // only after six contract instances already exist on-chain. The previous testnet
    // value was a 56-character look-alike that is not a valid strkey, so the first
    // `Address.fromString` threw halfway through the run. Validating up front turns
    // that into a two-second failure with no orphaned contracts.
    if (!StrKey.isValidContract(config.token)) {
        throw new Error(
            `config.token is not a valid Stellar contract address: ${config.token}. ` +
                'On testnet, the native XLM Stellar Asset Contract is ' +
                'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC.',
        );
    }
    if (!StrKey.isValidEd25519PublicKey(adminAddr)) {
        throw new Error(
            `config.admin is not a valid Stellar account: ${adminAddr}`,
        );
    }

    console.log(`\nZizaLend deployment → ${network}`);
    console.log(`admin : ${adminAddr}`);
    console.log(`token : ${config.token}\n`);

    // ── 1. Upload all WASM binaries ─────────────────────────────────────────────
    console.log('[1/6] Uploading WASM binaries…');
    const nftWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.remittance_nft.wasm),
        account,
        passphrase,
    );
    const poolWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.lending_pool.wasm),
        account,
        passphrase,
    );
    const managerWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.loan_manager.wasm),
        account,
        passphrase,
    );
    const govWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.multisig_governance.wasm),
        account,
        passphrase,
    );

    // ── 2. Instantiate contracts ────────────────────────────────────────────────
    console.log('\n[2/6] Creating contract instances…');

    console.log('  RemittanceNFT');
    const nftContractId = await createInstance(
        server,
        nftWasmHash,
        contractSalt('nft'),
        account,
        passphrase,
    );
    console.log(`    → ${nftContractId}`);

    console.log('  LendingPool');
    const poolContractId = await createInstance(
        server,
        poolWasmHash,
        contractSalt('pool'),
        account,
        passphrase,
    );
    console.log(`    → ${poolContractId}`);

    console.log('  LoanManager');
    const managerContractId = await createInstance(
        server,
        managerWasmHash,
        contractSalt('manager'),
        account,
        passphrase,
    );
    console.log(`    → ${managerContractId}`);

    // One governance instance per governed contract. `MultisigGovernance::finalize_admin_transfer`
    // invokes `set_admin` on the single target it was initialised with, so a shared
    // instance could only ever hand over one of the three.
    console.log('  Governance (governs LoanManager)');
    const managerGovContractId = await createInstance(
        server,
        govWasmHash,
        contractSalt('governance-manager'),
        account,
        passphrase,
    );
    console.log(`    → ${managerGovContractId}`);

    console.log('  Governance (governs LendingPool)');
    const poolGovContractId = await createInstance(
        server,
        govWasmHash,
        contractSalt('governance-pool'),
        account,
        passphrase,
    );
    console.log(`    → ${poolGovContractId}`);

    console.log('  Governance (governs RemittanceNFT)');
    const nftGovContractId = await createInstance(
        server,
        govWasmHash,
        contractSalt('governance-nft'),
        account,
        passphrase,
    );
    console.log(`    → ${nftGovContractId}`);

    // ── 3. Initialize in dependency order ──────────────────────────────────────
    //
    // Ordering constraints:
    //   a. NFT must be initialized before authorize_minter can be called.
    //   b. authorize_minter(LoanManager) must run BEFORE LoanManager.initialize,
    //      because LoanManager.initialize asserts it is already an authorized minter.
    //   c. LendingPool has no dependency on NFT or LoanManager at init time.
    //   d. LoanManager.initialize takes (nft, pool, token, admin) so both NFT and
    //      Pool addresses must be known first.
    //   e. Each Governance.initialize takes (admin, target_contract), naming the one
    //      contract that instance is allowed to hand the admin role to.
    //
    console.log('\n[3/6] Initializing contracts…');

    // Every step from here on is skipped when it has already been applied, so a
    // deployment interrupted at any point can be resumed by re-running this script.
    // Without these guards a second run dies on `AlreadyInitialized` — correct of the
    // contract, useless for the operator, and it strands the deployment in exactly the
    // half-configured state the guards exist to avoid.
    const readState = async (
        contractId: string,
        method: string,
        args: unknown[] = [],
    ) => {
        try {
            return await readContract(
                server,
                contractId,
                method,
                args,
                account,
                passphrase,
            );
        } catch {
            // An uninitialised instance has no admin to read, so the read itself fails.
            return undefined;
        }
    };
    const readBool = async (
        contractId: string,
        method: string,
        args: unknown[] = [],
    ) => {
        const value = await readState(contractId, method, args);
        return value === undefined ? false : scValToBool(value);
    };
    const readAddress = async (
        contractId: string,
        method: string,
        args: unknown[] = [],
    ) => {
        const value = await readState(contractId, method, args);
        return value === undefined ? undefined : scValToAddress(value);
    };
    const isInitialized = async (contractId: string) =>
        (await readState(contractId, 'get_admin')) !== undefined;

    // NFT
    if (await isInitialized(nftContractId)) {
        console.log('  NFT.initialize — already initialized, skipping');
    } else {
        console.log('  NFT.initialize');
        await invoke(
            server,
            nftContractId,
            'initialize',
            [adminAddr],
            account,
            passphrase,
        );
    }

    // Authorize LoanManager as minter BEFORE LoanManager.initialize checks for it.
    if (
        await readBool(nftContractId, 'is_authorized_minter', [
            managerContractId,
        ])
    ) {
        console.log(
            '  NFT.authorize_minter(LoanManager) — already authorized, skipping',
        );
    } else {
        console.log('  NFT.authorize_minter(LoanManager)');
        await invoke(
            server,
            nftContractId,
            'authorize_minter',
            [managerContractId],
            account,
            passphrase,
        );
    }

    // LendingPool. Takes the admin only: the token a market accepts is registered
    // separately via `allow_token` in step 4. Passing `config.token` here made the
    // call fail WASM argument decoding, because the contract's `initialize` has taken
    // a single `admin` argument since the deposit side moved to a fail-closed
    // allowlist.
    if (await isInitialized(poolContractId)) {
        console.log('  LendingPool.initialize — already initialized, skipping');
    } else {
        console.log('  LendingPool.initialize');
        await invoke(
            server,
            poolContractId,
            'initialize',
            [adminAddr],
            account,
            passphrase,
        );
    }

    // LoanManager — validates minter authorization on-chain during this call.
    if (await isInitialized(managerContractId)) {
        console.log('  LoanManager.initialize — already initialized, skipping');
    } else {
        console.log('  LoanManager.initialize');
        await invoke(
            server,
            managerContractId,
            'initialize',
            [nftContractId, poolContractId, config.token, adminAddr],
            account,
            passphrase,
        );
    }

    // Governance — one instance per governed contract.
    for (const [label, governorId, targetId] of [
        ['LoanManager', managerGovContractId, managerContractId],
        ['LendingPool', poolGovContractId, poolContractId],
        ['RemittanceNFT', nftGovContractId, nftContractId],
    ] as const) {
        if (await isInitialized(governorId)) {
            console.log(
                `  Governance.initialize(target=${label}) — already initialized, skipping`,
            );
        } else {
            console.log(`  Governance.initialize(target=${label})`);
            await invoke(
                server,
                governorId,
                'initialize',
                [adminAddr, targetId],
                account,
                passphrase,
            );
        }
    }

    // ── 4. Wire the roles the protocol cannot run without ───────────────────────
    //
    // Every call below is mandatory. A deployment that skips one is not merely
    // degraded: the failure it causes is described on each line, and in three of the
    // five cases the protocol is unusable rather than merely misconfigured.
    console.log('\n[4/6] Wiring contract roles…');

    // Principal can only leave the pool through the pool itself (a contract address
    // authorises only implicitly), so the pool must be told which LoanManager may ask
    // it to disburse. Without this every `approve_loan` fails with `LoanManagerNotSet`.
    if (
        (await readAddress(poolContractId, 'get_loan_manager')) ===
        managerContractId
    ) {
        console.log(
            '  LendingPool.set_loan_manager(LoanManager) — already wired, skipping',
        );
    } else {
        console.log('  LendingPool.set_loan_manager(LoanManager)');
        await invoke(
            server,
            poolContractId,
            'set_loan_manager',
            [managerContractId],
            account,
            passphrase,
        );
    }

    // Markets are fail-closed: deposits are refused for any token that has not been
    // opened. Without this no lender can fund the pool at all.
    if (await readBool(poolContractId, 'is_token_allowed', [config.token])) {
        console.log(
            `  LendingPool.allow_token(${config.token}) — already open, skipping`,
        );
    } else {
        console.log(`  LendingPool.allow_token(${config.token})`);
        await invoke(
            server,
            poolContractId,
            'allow_token',
            [config.token],
            account,
            passphrase,
        );
    }

    // The NFT moves a borrower's score only at the request of its single configured
    // recorder. Without this a repayment still succeeds, but never credits a score --
    // and the omission is reported on-chain as `ScoreReportSkipped`.
    if (
        (await readAddress(nftContractId, 'get_score_recorder')) ===
        managerContractId
    ) {
        console.log(
            '  RemittanceNFT.set_score_recorder(LoanManager) — already wired, skipping',
        );
    } else {
        console.log('  RemittanceNFT.set_score_recorder(LoanManager)');
        await invoke(
            server,
            nftContractId,
            'set_score_recorder',
            [managerContractId],
            account,
            passphrase,
        );
    }

    // Hand admin rotation to governance on all three governed contracts. Once set, a
    // contract's `set_admin` accepts the governance contract's authorisation only, so
    // the single admin key can no longer replace the admin directly. These run after
    // every admin-key configuration above, and the admin key keeps
    // `propose_admin`/`accept_admin` as a two-step escape hatch if governance becomes
    // unreachable.
    for (const [label, contractId, governorId] of [
        ['LendingPool', poolContractId, poolGovContractId],
        ['LoanManager', managerContractId, managerGovContractId],
        ['RemittanceNFT', nftContractId, nftGovContractId],
    ] as const) {
        if ((await readAddress(contractId, 'get_governance')) === governorId) {
            console.log(
                `  ${label}.set_governance(...) — already wired, skipping`,
            );
        } else {
            console.log(`  ${label}.set_governance(...)`);
            await invoke(
                server,
                contractId,
                'set_governance',
                [governorId],
                account,
                passphrase,
            );
        }
    }

    // ── 5. Configure protocol parameters ────────────────────────────────────────
    //
    // A deployment that stops at step 4 is fully wired and still cannot fund a loan of
    // consequence. `max_loan_amount` defaults to 50,000 stroops — 0.005 XLM — so every
    // borrower request above a rounding error is rejected as `InvalidAmount`. The
    // contracts ship these placeholders deliberately: choosing operating limits is a
    // deployment decision, not a compile-time one.
    //
    // Only ceilings are set here. Nothing in this step relaxes a guard. Raising a cap
    // permits larger legitimate positions; it does not let any caller do something it
    // could not do before. The withdrawal cooldown, the one-ledger minimum hold, the
    // score floor, and the fail-closed token allowlist all keep their deployed values.
    if (config.parameters) {
        console.log('\n[5/6] Configuring protocol parameters…');

        const {
            maxLoanAmount,
            maxPoolSize,
            minScore,
            interestRateBps,
            defaultTermLedgers,
        } = config.parameters as {
            maxLoanAmount?: string;
            maxPoolSize?: string;
            minScore?: number;
            interestRateBps?: number;
            defaultTermLedgers?: number;
        };

        // Each setter is compared against the on-chain value first, so this step is
        // idempotent in the same way as steps 3 and 4.
        // Encodes the value as `i128` internally. Passing the raw decimal string would
        // produce `ScVal::String`, and a mis-typed argument traps the VM *inside* the
        // contract rather than returning a typed error — the failure mode the first
        // Testnet deployment died on, and one that reads as a contract defect.
        const applyI128 = async (
            label: string,
            contractId: string,
            reader: string,
            readerArgs: unknown[],
            setter: string,
            value: string,
            buildArgs: (encoded: xdr.ScVal) => unknown[],
        ) => {
            const current = await readState(contractId, reader, readerArgs);
            if (
                current !== undefined &&
                scValToI128(current) === BigInt(value)
            ) {
                console.log(`  ${label} — already set, skipping`);
                return;
            }
            console.log(`  ${label}`);
            await invoke(
                server,
                contractId,
                setter,
                buildArgs(i128(value)),
                account,
                passphrase,
            );
        };

        const applyU32 = async (
            label: string,
            reader: string,
            setter: string,
            value: number,
        ) => {
            const current = await readState(managerContractId, reader);
            if (current !== undefined && scValToU32(current) === value) {
                console.log(`  ${label} — already set, skipping`);
                return;
            }
            console.log(`  ${label}`);
            await invoke(
                server,
                managerContractId,
                setter,
                [u32(value)],
                account,
                passphrase,
            );
        };

        if (maxLoanAmount !== undefined) {
            await applyI128(
                `LoanManager.set_max_loan_amount(${maxLoanAmount})`,
                managerContractId,
                'get_max_loan_amount',
                [],
                'set_max_loan_amount',
                maxLoanAmount,
                (encoded) => [encoded],
            );
        }

        if (maxPoolSize !== undefined) {
            await applyI128(
                `LendingPool.set_max_pool_size(${maxPoolSize})`,
                poolContractId,
                'get_max_pool_size',
                [config.token],
                'set_max_pool_size',
                maxPoolSize,
                (encoded) => [config.token, encoded],
            );
        }

        if (minScore !== undefined) {
            await applyU32(
                `LoanManager.set_min_score(${minScore})`,
                'get_min_score',
                'set_min_score',
                minScore,
            );
        }

        if (interestRateBps !== undefined) {
            await applyU32(
                `LoanManager.set_interest_rate(${interestRateBps})`,
                'get_interest_rate',
                'set_interest_rate',
                interestRateBps,
            );
        }

        if (defaultTermLedgers !== undefined) {
            await applyU32(
                `LoanManager.set_default_term(${defaultTermLedgers})`,
                'get_default_term',
                'set_default_term',
                defaultTermLedgers,
            );
        }
    }

    // ── 5. Persist contract IDs ─────────────────────────────────────────────────
    console.log('\n[6/6] Writing contract addresses to .env files…');

    // The two runtimes read different names for the same values: the frontend reads
    // `NEXT_PUBLIC_*`, the backend reads the unprefixed names (see backend/.env.example).
    // Appending one shared block to both files is how the backend ended up holding
    // `NEXT_PUBLIC_*` variables it never reads, and none of the IDs it does read.
    const header = `\n# ZizaLend contracts — ${network} — ${new Date().toISOString()}`;

    const frontendEnvBlock = [
        header,
        `NEXT_PUBLIC_NFT_CONTRACT_ID=${nftContractId}`,
        `NEXT_PUBLIC_POOL_CONTRACT_ID=${poolContractId}`,
        `NEXT_PUBLIC_MANAGER_CONTRACT_ID=${managerContractId}`,
        `NEXT_PUBLIC_LOAN_MANAGER_CONTRACT_ID=${managerContractId}`,
        `NEXT_PUBLIC_GOVERNANCE_CONTRACT_ID=${managerGovContractId}`,
        `NEXT_PUBLIC_POOL_GOVERNANCE_CONTRACT_ID=${poolGovContractId}`,
        `NEXT_PUBLIC_NFT_GOVERNANCE_CONTRACT_ID=${nftGovContractId}`,
    ].join('\n');

    const backendEnvBlock = [
        header,
        `REMITTANCE_NFT_CONTRACT_ID=${nftContractId}`,
        `LENDING_POOL_CONTRACT_ID=${poolContractId}`,
        `LOAN_MANAGER_CONTRACT_ID=${managerContractId}`,
        `MULTISIG_GOVERNANCE_CONTRACT_ID=${managerGovContractId}`,
        `POOL_GOVERNANCE_CONTRACT_ID=${poolGovContractId}`,
        `NFT_GOVERNANCE_CONTRACT_ID=${nftGovContractId}`,
        `POOL_TOKEN_ADDRESS=${config.token}`,
    ].join('\n');

    await fs.appendFile(
        path.join(__dirname, '../frontend/.env.local'),
        frontendEnvBlock,
    );
    await fs.appendFile(
        path.join(__dirname, '../backend/.env'),
        backendEnvBlock,
    );

    console.log('\nDeployment complete.');
    console.log(`  RemittanceNFT  : ${nftContractId}`);
    console.log(`  LendingPool    : ${poolContractId}`);
    console.log(`  LoanManager    : ${managerContractId}`);
    console.log(`  Gov (manager)  : ${managerGovContractId}`);
    console.log(`  Gov (pool)     : ${poolGovContractId}`);
    console.log(`  Gov (nft)      : ${nftGovContractId}`);
    console.log(
        "\nNext: configure each governance instance's signer quorum with",
    );
    console.log(
        '      propose_admin_transfer(...) before relying on it for a hand-off.',
    );
}

main().catch((error) => {
    console.error(
        '\nDeployment failed:',
        error instanceof Error ? error.message : error,
    );
    process.exit(1);
});
