/**
 * Type-aware conversion of JavaScript values into Soroban `ScVal` contract arguments.
 *
 * Why this module exists
 * ----------------------
 * `nativeToScVal` infers an `ScVal` from the JavaScript type alone. A `string` becomes
 * `ScVal::String`, which is the wrong type for every `Address` parameter. Soroban does
 * not report a type mismatch as a typed contract error: the host traps the VM with
 * `UnreachableCodeReached` and the diagnostic event points at a function inside the
 * contract, so the mistake looks like a defect in the contract rather than in the
 * caller. The first live Testnet deployment failed on `RemittanceNFT.initialize` for
 * precisely this reason, after the contracts had already passed `cargo test`, Clippy,
 * and a WASM-size budget.
 *
 * Stellar strkeys are unambiguous, so they can be detected safely:
 *
 *   - base32, 56 characters
 *   - `G` prefix for ed25519 accounts, `C` prefix for contract addresses
 *   - CRC16 checksum, which a random token of the right length will not satisfy
 *
 * Numbers are *not* inferred. `u32`, `i64`, `u64`, and `i128` are distinct on-chain
 * types and there is no safe default, so each has an explicit helper.
 */
import { Address, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk';

/** `i128` — the type every token amount in this protocol uses. */
export const i128 = (value: bigint | number | string): xdr.ScVal =>
    nativeToScVal(BigInt(value), { type: 'i128' });

/** `u32` — ledger counts, basis points, loan ids, and score thresholds. */
export const u32 = (value: number): xdr.ScVal =>
    nativeToScVal(value, { type: 'u32' });

/** `u64` — unix-second timestamps. */
export const u64 = (value: bigint | number | string): xdr.ScVal =>
    nativeToScVal(BigInt(value), { type: 'u64' });

/** A Stellar account (`G…`) or contract (`C…`) address, as `ScVal::Address`. */
export const address = (value: string): xdr.ScVal =>
    Address.fromString(value).toScVal();

/** `Vec<Address>`, e.g. a governance signer set. */
export const addressVec = (values: string[]): xdr.ScVal =>
    xdr.ScVal.scvVec(values.map(address));

/**
 * Convert a caller-supplied argument.
 *
 * Accepts an already-built `ScVal` (use the typed helpers above), a Stellar strkey
 * (encoded as `ScVal::Address`), or any value `nativeToScVal` understands.
 */
export function toScVal(arg: unknown): xdr.ScVal {
    if (arg instanceof xdr.ScVal) return arg;
    if (
        typeof arg === 'string' &&
        (StrKey.isValidContract(arg) || StrKey.isValidEd25519PublicKey(arg))
    ) {
        return address(arg);
    }
    return nativeToScVal(arg);
}

/** Encode a positional argument list. */
export const toScVals = (args: unknown[]): xdr.ScVal[] => args.map(toScVal);

/** Read a `bool` back out of a returned `ScVal`. */
export function scValToBool(value: xdr.ScVal): boolean {
    return value.switch().name === 'scvBool' && value.b();
}

/** Read a `u32` back out of a returned `ScVal`. */
export function scValToU32(value: xdr.ScVal): number {
    return value.u32();
}

/** Read an `i128` back out of a returned `ScVal`. */
export function scValToI128(value: xdr.ScVal): bigint {
    const parts = value.i128();
    return (
        (BigInt(parts.hi().toString()) << 64n) | BigInt(parts.lo().toString())
    );
}

/** Read an address back out of a returned `ScVal`, or `undefined` if it is not one. */
export function scValToAddress(value: xdr.ScVal): string | undefined {
    if (value.switch().name !== 'scvAddress') return undefined;
    const scAddress = value.address();
    if (scAddress.switch().name !== 'scAddressTypeContract') {
        return Address.fromScAddress(scAddress).toString();
    }
    return StrKey.encodeContract(
        Buffer.from(scAddress.contractId() as unknown as Uint8Array),
    );
}
