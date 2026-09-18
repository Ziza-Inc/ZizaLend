import {
    Keypair,
    Operation,
    TransactionBuilder,
    rpc as Rpc,
    Address,
    xdr,
    StrKey,
} from '@stellar/stellar-sdk';
import { createHash } from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { toScVal } from './scval';

dotenv.config();

const CONFIG_PATH = path.join(__dirname, 'deploy-config.json');
const POLL_INTERVAL_MS = 2000;

// Compute the SHA-256 hash of WASM bytes — this is the on-chain upload key.
function computeWasmHash(wasm: Buffer): Buffer {
    return createHash('sha256').update(wasm).digest();
}

// Deterministic per-contract salt so re-runs don't stomp each other's addresses.
function contractSalt(name: string): Buffer {
    return createHash('sha256').update(`ZizaLend:${name}`).digest();
}

// Derive the address a `createCustomContract` call will produce, without submitting it.
//
// A contract created from an account and a salt has a *deterministic* address:
//
//     contractId = sha256( HashIdPreimage {
//         ENVELOPE_TYPE_CONTRACT_ID,
//         networkId = sha256(networkPassphrase),
//         ContractIDPreimage::Address { source, salt },
//     } )
//
// Knowing this before submitting is what makes a deployment re-runnable. Without it,
// a second run of this script re-derives the same salt, re-issues the create, and dies
// on `Error(Storage, ExistingValue)` partway through -- leaving a half-configured
// deployment that must be fixed by hand. Here the address is computed first, the
// instance is created only when it is absent, and the derived address is checked
// against the address the host actually returns.
function deriveContractId(account: Keypair, salt: Buffer, networkPassphrase: string): string {
    const networkId = createHash('sha256').update(networkPassphrase).digest();
    const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
        new xdr.HashIdPreimageContractId({
            networkId,
            contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                new xdr.ContractIdPreimageFromAddress({
                    address: Address.fromString(account.publicKey()).toScAddress(),
                    salt,
                }),
            ),
        }),
    );
    return StrKey.encodeContract(createHash('sha256').update(preimage.toXDR()).digest());
}

// True when a contract instance already exists at `contractId`.
async function contractInstanceExists(server: Rpc.Server, contractId: string): Promise<boolean> {
    try {
        await server.getContractData(
            contractId,
            xdr.ScVal.scvLedgerKeyContractInstance(),
            Rpc.Durability.Persistent,
        );
        return true;
    } catch {
        return false;
    }
}

// Read the contract address out of a host function's return value.
//
// `HostFunction::CreateContract` returns the new contract's `ScVal::Address`, and
// simulation reports that return value without needing a ledger. This is the
// authoritative source for the address: the contract ID is derived from
// (source account, salt), and the host computes exactly that derivation, so a
// simulation is as sound as the executed transaction for this one value.
//
// Returns `undefined` for any other shape so callers can fall back.
function contractIdFromRetval(retval: xdr.ScVal): string | undefined {
    if (retval.switch().name !== 'scvAddress') return undefined;
    const address = retval.address();
    if (address.switch().name !== 'scAddressTypeContract') return undefined;
    return StrKey.encodeContract(Buffer.from(address.contractId() as unknown as Uint8Array));
}

// Fallback: scan the transaction result metadata for the created contract instance.
//
// This is kept as a second opinion rather than the primary path because it depends
// on how the RPC client decoded `resultMetaXdr`, which is not part of the protocol
// contract. Returns `undefined` instead of throwing so the caller can decide.
function extractContractId(resultMeta: xdr.TransactionMeta): string | undefined {
    let v3: xdr.TransactionMetaV3;
    try {
        v3 = resultMeta.v3();
    } catch {
        // The client may hand back a meta whose union tag is not populated.
        return undefined;
    }
    for (const opMeta of v3.operations()) {
        for (const change of opMeta.changes()) {
            if (change.switch().name !== 'ledgerEntryCreated') continue;
            const data = change.created().data();
            if (data.switch().name !== 'contractData') continue;
            const cd = data.contractData();
            if (cd.key().switch().name !== 'scvLedgerKeyContractInstance') continue;
            const contract = cd.contract();
            if (contract.switch().name === 'scAddressTypeContract') {
                return StrKey.encodeContract(
                    Buffer.from(contract.contractId() as unknown as Uint8Array),
                );
            }
        }
    }
    return undefined;
}

// The simulation and execution result of a submitted transaction.
interface TxOutcome {
    response: Rpc.Api.GetSuccessfulTransactionResponse;
    retval: xdr.ScVal;
}

async function sendTx(
    server: Rpc.Server,
    tx: ReturnType<TransactionBuilder['build']>,
    account: Keypair,
): Promise<TxOutcome> {
    const sim = await server.simulateTransaction(tx);
    if (Rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${JSON.stringify(sim.error, null, 2)}`);
    }

    const preparedTx = await server.prepareTransaction(tx);
    preparedTx.sign(account);

    const sendResponse = await server.sendTransaction(preparedTx);
    if (sendResponse.status !== 'PENDING') {
        throw new Error(`Send failed: ${JSON.stringify(sendResponse, null, 2)}`);
    }

    console.log(`    tx ${sendResponse.hash} … polling`);

    let txResponse = await server.getTransaction(sendResponse.hash);
    while (txResponse.status === 'NOT_FOUND') {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        txResponse = await server.getTransaction(sendResponse.hash);
    }

    if (txResponse.status !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${JSON.stringify(txResponse, null, 2)}`);
    }

    return {
        response: txResponse as Rpc.Api.GetSuccessfulTransactionResponse,
        retval: sim.result!.retval,
    };
}

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

    console.log(`  uploading ${path.basename(wasmPath)} (hash ${wasmHash.toString('hex').slice(0, 12)}…)`);

    const source = await server.getAccount(account.publicKey());
    const tx = new TransactionBuilder(source, { fee: '100000', networkPassphrase })
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
    const tx = new TransactionBuilder(source, { fee: '100000', networkPassphrase })
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

// Call a contract function with positional arguments.
async function invoke(
    server: Rpc.Server,
    contractId: string,
    method: string,
    args: unknown[],
    account: Keypair,
    networkPassphrase: string,
): Promise<void> {
    const source = await server.getAccount(account.publicKey());
    const tx = new TransactionBuilder(source, { fee: '100000', networkPassphrase })
        .addOperation(
            Operation.invokeHostFunction({
                func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                    new xdr.InvokeContractArgs({
                        contractAddress: Address.fromString(contractId).toScAddress(),
                        functionName: method,
                        args: args.map(toScVal),
                    }),
                ),
                auth: [],
            }),
        )
        .setTimeout(30)
        .build();

    await sendTx(server, tx, account);
}

async function main() {
    const network = process.argv[2] || 'testnet';
    const config = (await fs.readJson(CONFIG_PATH))[network];
    if (!config) throw new Error(`No config for network: ${network}`);

    const secretKey = process.env.SECRET_KEY;
    if (!secretKey) throw new Error('SECRET_KEY environment variable is required');

    const account = Keypair.fromSecret(secretKey);
    // Fall back to the deployer's own key when admin is not set in config.
    const adminAddr =
        config.admin === 'YOUR_ADMIN_PUBLIC_KEY' ? account.publicKey() : config.admin;

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
        throw new Error(`config.admin is not a valid Stellar account: ${adminAddr}`);
    }

    console.log(`\nZizaLend deployment → ${network}`);
    console.log(`admin : ${adminAddr}`);
    console.log(`token : ${config.token}\n`);

    // ── 1. Upload all WASM binaries ─────────────────────────────────────────────
    console.log('[1/5] Uploading WASM binaries…');
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
    console.log('\n[2/5] Creating contract instances…');

    console.log('  RemittanceNFT');
    const nftContractId = await createInstance(server, nftWasmHash, contractSalt('nft'), account, passphrase);
    console.log(`    → ${nftContractId}`);

    console.log('  LendingPool');
    const poolContractId = await createInstance(server, poolWasmHash, contractSalt('pool'), account, passphrase);
    console.log(`    → ${poolContractId}`);

    console.log('  LoanManager');
    const managerContractId = await createInstance(server, managerWasmHash, contractSalt('manager'), account, passphrase);
    console.log(`    → ${managerContractId}`);

    // One governance instance per governed contract. `MultisigGovernance::finalize_admin_transfer`
    // invokes `set_admin` on the single target it was initialised with, so a shared
    // instance could only ever hand over one of the three.
    console.log('  Governance (governs LoanManager)');
    const managerGovContractId = await createInstance(server, govWasmHash, contractSalt('governance-manager'), account, passphrase);
    console.log(`    → ${managerGovContractId}`);

    console.log('  Governance (governs LendingPool)');
    const poolGovContractId = await createInstance(server, govWasmHash, contractSalt('governance-pool'), account, passphrase);
    console.log(`    → ${poolGovContractId}`);

    console.log('  Governance (governs RemittanceNFT)');
    const nftGovContractId = await createInstance(server, govWasmHash, contractSalt('governance-nft'), account, passphrase);
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
    console.log('\n[3/5] Initializing contracts…');

    // NFT
    console.log('  NFT.initialize');
    await invoke(server, nftContractId, 'initialize', [adminAddr], account, passphrase);

    // Authorize LoanManager as minter BEFORE LoanManager.initialize checks for it.
    console.log('  NFT.authorize_minter(LoanManager)');
    await invoke(server, nftContractId, 'authorize_minter', [managerContractId], account, passphrase);

    // LendingPool. Takes the admin only: the token a market accepts is registered
    // separately via `allow_token` in step 4. Passing `config.token` here made the
    // call fail WASM argument decoding, because the contract's `initialize` has taken
    // a single `admin` argument since the deposit side moved to a fail-closed
    // allowlist.
    console.log('  LendingPool.initialize');
    await invoke(server, poolContractId, 'initialize', [adminAddr], account, passphrase);

    // LoanManager — validates minter authorization on-chain during this call.
    console.log('  LoanManager.initialize');
    await invoke(
        server,
        managerContractId,
        'initialize',
        [nftContractId, poolContractId, config.token, adminAddr],
        account,
        passphrase,
    );

    // Governance — one instance per governed contract.
    console.log('  Governance.initialize(target=LoanManager)');
    await invoke(server, managerGovContractId, 'initialize', [adminAddr, managerContractId], account, passphrase);
    console.log('  Governance.initialize(target=LendingPool)');
    await invoke(server, poolGovContractId, 'initialize', [adminAddr, poolContractId], account, passphrase);
    console.log('  Governance.initialize(target=RemittanceNFT)');
    await invoke(server, nftGovContractId, 'initialize', [adminAddr, nftContractId], account, passphrase);

    // ── 4. Wire the roles the protocol cannot run without ───────────────────────
    //
    // Every call below is mandatory. A deployment that skips one is not merely
    // degraded: the failure it causes is described on each line, and in three of the
    // five cases the protocol is unusable rather than merely misconfigured.
    console.log('\n[4/5] Wiring contract roles…');

    // Principal can only leave the pool through the pool itself (a contract address
    // authorises only implicitly), so the pool must be told which LoanManager may ask
    // it to disburse. Without this every `approve_loan` fails with `LoanManagerNotSet`.
    console.log('  LendingPool.set_loan_manager(LoanManager)');
    await invoke(server, poolContractId, 'set_loan_manager', [managerContractId], account, passphrase);

    // Markets are fail-closed: deposits are refused for any token that has not been
    // opened. Without this no lender can fund the pool at all.
    console.log(`  LendingPool.allow_token(${config.token})`);
    await invoke(server, poolContractId, 'allow_token', [config.token], account, passphrase);

    // The NFT moves a borrower's score only at the request of its single configured
    // recorder. Without this a repayment still succeeds, but never credits a score --
    // and the omission is reported on-chain as `ScoreReportSkipped`.
    console.log('  RemittanceNFT.set_score_recorder(LoanManager)');
    await invoke(server, nftContractId, 'set_score_recorder', [managerContractId], account, passphrase);

    // Hand admin rotation to governance on all three governed contracts. Once set, a
    // contract's `set_admin` accepts the governance contract's authorisation only, so
    // the single admin key can no longer replace the admin directly. These run after
    // every admin-key configuration above, and the admin key keeps
    // `propose_admin`/`accept_admin` as a two-step escape hatch if governance becomes
    // unreachable.
    console.log('  LendingPool.set_governance(...)');
    await invoke(server, poolContractId, 'set_governance', [poolGovContractId], account, passphrase);
    console.log('  LoanManager.set_governance(...)');
    await invoke(server, managerContractId, 'set_governance', [managerGovContractId], account, passphrase);
    console.log('  RemittanceNFT.set_governance(...)');
    await invoke(server, nftContractId, 'set_governance', [nftGovContractId], account, passphrase);

    // ── 5. Persist contract IDs ─────────────────────────────────────────────────
    console.log('\n[5/5] Writing contract addresses to .env files…');

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

    await fs.appendFile(path.join(__dirname, '../frontend/.env.local'), frontendEnvBlock);
    await fs.appendFile(path.join(__dirname, '../backend/.env'), backendEnvBlock);

    console.log('\nDeployment complete.');
    console.log(`  RemittanceNFT  : ${nftContractId}`);
    console.log(`  LendingPool    : ${poolContractId}`);
    console.log(`  LoanManager    : ${managerContractId}`);
    console.log(`  Gov (manager)  : ${managerGovContractId}`);
    console.log(`  Gov (pool)     : ${poolGovContractId}`);
    console.log(`  Gov (nft)      : ${nftGovContractId}`);
    console.log('\nNext: configure each governance instance\'s signer quorum with');
    console.log('      propose_admin_transfer(...) before relying on it for a hand-off.');
}

main().catch(error => {
    console.error('\nDeployment failed:', error instanceof Error ? error.message : error);
    process.exit(1);
});
