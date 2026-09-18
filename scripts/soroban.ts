/**
 * Shared Soroban plumbing: transaction submission, contract-address derivation, and
 * contract invocation.
 *
 * Extracted so that `deploy.ts` and `smoke-testnet.ts` use one implementation. The
 * three defects that made the first Testnet deployment impossible — a wrong
 * `initialize` arity, arguments encoded as `ScVal::String` instead of
 * `ScVal::Address`, and a non-idempotent create step — all lived in code that would
 * otherwise have been copied into the smoke test as well.
 */
import {
    Account,
    Address,
    Keypair,
    Operation,
    TransactionBuilder,
    rpc as Rpc,
    xdr,
    StrKey,
} from '@stellar/stellar-sdk';
import { createHash } from 'crypto';
import { toScVals } from './scval';

export const POLL_INTERVAL_MS = 2000;

/** The built transaction type, before submission. */
export type BuiltTransaction = ReturnType<TransactionBuilder['build']>;

/** The simulation and execution result of a submitted transaction. */
export interface TxOutcome {
    response: Rpc.Api.GetSuccessfulTransactionResponse;
    /** The host function's return value, taken from simulation. */
    retval: xdr.ScVal;
}

/** SHA-256 of the WASM bytes — the on-chain key a contract instance is created from. */
export function computeWasmHash(wasm: Buffer): Buffer {
    return createHash('sha256').update(wasm).digest();
}

/** Deterministic per-contract salt, so re-runs address the same instances. */
export function contractSalt(name: string): Buffer {
    return createHash('sha256').update(`ZizaLend:${name}`).digest();
}

/**
 * Derive the address a `createCustomContract` call will produce, without submitting it.
 *
 *     contractId = sha256( HashIdPreimage {
 *         ENVELOPE_TYPE_CONTRACT_ID,
 *         networkId = sha256(networkPassphrase),
 *         ContractIDPreimage::Address { source, salt },
 *     } )
 *
 * Knowing this before submitting is what makes a deployment re-runnable. Without it, a
 * second run re-derives the same salt, re-issues the create, and dies on
 * `Error(Storage, ExistingValue)` partway through, leaving a half-configured
 * deployment to be repaired by hand.
 */
export function deriveContractId(
    account: Keypair,
    salt: Buffer,
    networkPassphrase: string,
): string {
    const networkId = createHash('sha256').update(networkPassphrase).digest();
    const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
        new xdr.HashIdPreimageContractId({
            networkId,
            contractIdPreimage:
                xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                    new xdr.ContractIdPreimageFromAddress({
                        address: Address.fromString(
                            account.publicKey(),
                        ).toScAddress(),
                        salt,
                    }),
                ),
        }),
    );
    return StrKey.encodeContract(
        createHash('sha256').update(preimage.toXDR()).digest(),
    );
}

/** True when a contract instance already exists at `contractId`. */
export async function contractInstanceExists(
    server: Rpc.Server,
    contractId: string,
): Promise<boolean> {
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

/**
 * Read the contract address out of a host function's return value.
 *
 * `HostFunction::CreateContract` returns the new contract's `ScVal::Address`, and
 * simulation reports that value without needing a ledger. Returns `undefined` for any
 * other shape so callers can fall back.
 */
export function contractIdFromRetval(retval: xdr.ScVal): string | undefined {
    if (retval.switch().name !== 'scvAddress') return undefined;
    const address = retval.address();
    if (address.switch().name !== 'scAddressTypeContract') return undefined;
    return StrKey.encodeContract(
        Buffer.from(address.contractId() as unknown as Uint8Array),
    );
}

/**
 * Fallback: scan transaction result metadata for the created contract instance.
 *
 * Kept as a second opinion rather than the primary path, because it depends on how the
 * RPC client decoded `resultMetaXdr` — which is not part of the protocol contract, and
 * in practice arrived with an unpopulated union tag. Returns `undefined` instead of
 * throwing so the caller can decide.
 */
export function extractContractId(
    resultMeta: xdr.TransactionMeta,
): string | undefined {
    let v3: xdr.TransactionMetaV3;
    try {
        v3 = resultMeta.v3();
    } catch {
        return undefined;
    }
    for (const opMeta of v3.operations()) {
        for (const change of opMeta.changes()) {
            if (change.switch().name !== 'ledgerEntryCreated') continue;
            const data = change.created().data();
            if (data.switch().name !== 'contractData') continue;
            const cd = data.contractData();
            if (cd.key().switch().name !== 'scvLedgerKeyContractInstance')
                continue;
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

/** Simulate, sign, submit, and poll a transaction to a terminal result. */
export async function sendTx(
    server: Rpc.Server,
    tx: BuiltTransaction,
    account: Keypair,
    onSubmitted?: (hash: string) => void,
): Promise<TxOutcome> {
    const sim = await server.simulateTransaction(tx);
    if (Rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${sim.error}`);
    }

    const preparedTx = await server.prepareTransaction(tx);
    preparedTx.sign(account);

    const sendResponse = await server.sendTransaction(preparedTx);
    if (sendResponse.status !== 'PENDING') {
        throw new Error(
            `Send failed: ${JSON.stringify(sendResponse, null, 2)}`,
        );
    }

    onSubmitted?.(sendResponse.hash);

    let txResponse = await server.getTransaction(sendResponse.hash);
    while (txResponse.status === 'NOT_FOUND') {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        txResponse = await server.getTransaction(sendResponse.hash);
    }

    if (txResponse.status !== 'SUCCESS') {
        throw new Error(
            `Transaction failed: ${JSON.stringify(txResponse, null, 2)}`,
        );
    }

    return {
        response: txResponse as Rpc.Api.GetSuccessfulTransactionResponse,
        retval: sim.result!.retval,
    };
}

/** Build an invocation of `method` on `contractId` without submitting it. */
export function buildInvocation(
    source: Account,
    contractId: string,
    method: string,
    args: unknown[],
    networkPassphrase: string,
): BuiltTransaction {
    return new TransactionBuilder(source, { fee: '100000', networkPassphrase })
        .addOperation(
            Operation.invokeHostFunction({
                func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                    new xdr.InvokeContractArgs({
                        contractAddress:
                            Address.fromString(contractId).toScAddress(),
                        functionName: method,
                        args: toScVals(args),
                    }),
                ),
                auth: [],
            }),
        )
        .setTimeout(30)
        .build();
}

/** Call a contract function, submitting the transaction. */
export async function invoke(
    server: Rpc.Server,
    contractId: string,
    method: string,
    args: unknown[],
    account: Keypair,
    networkPassphrase: string,
    onSubmitted?: (hash: string) => void,
): Promise<TxOutcome> {
    const source = await server.getAccount(account.publicKey());
    const tx = buildInvocation(
        source,
        contractId,
        method,
        args,
        networkPassphrase,
    );
    return sendTx(server, tx, account, onSubmitted);
}

/**
 * Call a read-only contract function and return its value, without submitting.
 *
 * Used by the smoke test's post-conditions. Simulating rather than sending keeps a
 * verification step from mutating the state it is verifying.
 */
export async function readContract(
    server: Rpc.Server,
    contractId: string,
    method: string,
    args: unknown[],
    account: Keypair,
    networkPassphrase: string,
): Promise<xdr.ScVal> {
    const source = await server.getAccount(account.publicKey());
    const tx = buildInvocation(
        source,
        contractId,
        method,
        args,
        networkPassphrase,
    );
    const sim = await server.simulateTransaction(tx);
    if (Rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation of ${method} failed: ${sim.error}`);
    }
    return sim.result!.retval;
}
