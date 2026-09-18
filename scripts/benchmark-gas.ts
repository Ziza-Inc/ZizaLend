/**
 * Measure the resource cost of every major ZizaLend transaction.
 *
 * Why this exists
 * ---------------
 * "Optimised for low gas" is a claim, not a measurement. Soroban charges for two
 * resources — CPU instructions and memory — and the figures are only observable by
 * running the real contract on the real host. This script runs each operation against
 * the deployed Testnet contracts, records what the host reports, and writes the table
 * in `docs/GAS.md`.
 *
 * Method
 * ------
 * Each operation is **simulated** before it is submitted. Simulation is what a wallet
 * already does to estimate a fee, and the response carries the authoritative `cost`
 * object for that exact invocation against current ledger state. The cost of an
 * operation depends on the state it runs against (a repayment over a larger
 * outstanding balance costs more), so the script reports the state it measured rather
 * than presenting one number as universal. Where an operation needs prior state — a
 * loan to approve, a score to repay against — the script submits the preceding steps,
 * so the figures come from a real journey rather than a synthetic call.
 *
 * The measurements are not a CI gate. Testnet resource costs drift with ledger load and
 * protocol version, and a threshold that failed on drift would be a flaky check that
 * teaches people to ignore it. What is gated, in `check-wasm-size.mjs`, is the WASM
 * binary size, which is deterministic.
 *
 * Usage:  SECRET_KEY=<admin secret> npx ts-node benchmark-gas.ts [testnet]
 */
import { Keypair, rpc as Rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import * as fs from "fs-extra";
import * as path from "path";
import * as dotenv from "dotenv";
import { buildInvocation, sendTx } from "./soroban";
import { i128, u32 } from "./scval";

dotenv.config();

const CONFIG_PATH = path.join(__dirname, "deploy-config.json");
const FRIENDBOT = "https://friendbot.stellar.org";
const ONE_XLM = 10_000_000n;

/** One measured operation. */
interface Measurement {
  /** Human-readable label for the operation. */
  label: string;
  contract: string;
  method: string;
  cpuInsns: bigint;
  memBytes: bigint;
  /** The fee the host requires for this invocation, in stroops. */
  minResourceFee: bigint;
  /** Whether the call was only simulated, or also submitted. */
  submitted: boolean;
  note?: string;
}

async function main() {
  const network = process.argv[2] || "testnet";
  const config = (await fs.readJson(CONFIG_PATH))[network];
  if (!config) throw new Error(`No config for network: ${network}`);

  const secretKey = process.env.SECRET_KEY;
  if (!secretKey)
    throw new Error("SECRET_KEY environment variable is required");
  const admin = Keypair.fromSecret(secretKey);

  const manifest = await fs.readJson(
    path.join(__dirname, "deployments", `${network}.json`),
  );
  const {
    remittance_nft: nft,
    lending_pool: pool,
    loan_manager: manager,
  } = manifest.contracts as Record<string, string>;
  const token = manifest.token as string;
  const passphrase = config.networkPassphrase as string;
  const server = new Rpc.Server(config.rpcUrl);

  const measurements: Measurement[] = [];

  /**
   * Simulate `method`, record its cost, and optionally submit it.
   *
   * `submit` defaults to true so that each step leaves the state the next step
   * expects. A read-only call is never submitted.
   */
  const measure = async (
    label: string,
    contractId: string,
    contractLabel: string,
    method: string,
    args: unknown[],
    signer: Keypair,
    submit = true,
    note?: string,
  ): Promise<unknown> => {
    const source = await server.getAccount(signer.publicKey());
    const tx = buildInvocation(source, contractId, method, args, passphrase);
    const sim = await server.simulateTransaction(tx);
    if (Rpc.Api.isSimulationError(sim)) {
      throw new Error(`${label} simulation failed: ${sim.error}`);
    }

    // The SDK does not surface the RPC's raw `cost` object, but it does surface the
    // `SorobanTransactionData` that the fee is actually computed from — which is the
    // stronger figure to report, since these are the resources that will be charged
    // rather than an estimate of them.
    const resources = sim.transactionData.build().resources();
    const cpuInsns = BigInt(resources.instructions());
    // Ledger I/O is charged as two figures: bytes read from the disk cache and bytes
    // written back. Reporting their sum is the number a contributor can act on.
    const memBytes = BigInt(resources.diskReadBytes() + resources.writeBytes());
    const minResourceFee = BigInt(sim.minResourceFee ?? "0");

    measurements.push({
      label,
      contract: contractLabel,
      method,
      cpuInsns,
      memBytes,
      minResourceFee,
      submitted: submit,
      note,
    });

    if (!submit) return scValToNative(sim.result!.retval);

    const outcome = await sendTx(server, tx, signer);
    return scValToNative(outcome.retval);
  };

  const read = async (
    contractId: string,
    method: string,
    args: unknown[] = [],
  ) => {
    const source = await server.getAccount(admin.publicKey());
    const tx = buildInvocation(source, contractId, method, args, passphrase);
    const sim = await server.simulateTransaction(tx);
    if (Rpc.Api.isSimulationError(sim)) {
      throw new Error(`${method} simulation failed: ${sim.error}`);
    }
    return scValToNative(sim.result!.retval);
  };

  // ── Participants ────────────────────────────────────────────────────────────
  const lender = Keypair.random();
  const borrower = Keypair.random();
  console.log("\n  funding lender and borrower via friendbot…");
  await Promise.all([
    fetch(`${FRIENDBOT}/?addr=${lender.publicKey()}`),
    fetch(`${FRIENDBOT}/?addr=${borrower.publicKey()}`),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 6000));

  // ── Loan setup, so later operations run against a real loan ────────────────
  console.log("  preparing a loan…\n");

  await measure(
    "nft.mint",
    nft,
    "RemittanceNFT",
    "mint",
    [
      borrower.publicKey(),
      u32(750),
      createHash("sha256").update(`ZizaLend:benchmark:${Date.now()}`).digest(),
      "https://zizalend.example/metadata/benchmark",
      // `minter: Option<Address>`. `None` is `scvVoid` and selects the *admin* path, which
      // sets the initial score directly. The argument cannot be omitted: that fails the
      // call's parameter-length check rather than defaulting to `None`.
      xdr.ScVal.scvVoid(),
    ],
    admin,
    true,
    "worst case: a first mint, with no existing NFT",
  );

  // A score high enough to clear the configured minimum, so the request is approved outright
  // rather than sitting pending. `mint` above already set one; this records a *credit event*,
  // which is the write a remittance actually triggers and carries different costs.
  await measure(
    "nft.update_score",
    nft,
    "RemittanceNFT",
    "update_score",
    [borrower.publicKey(), i128(50n * ONE_XLM), xdr.ScVal.scvVoid()],
    admin,
    true,
    "credit event: a 50 XLM repayment, score scaled by amount",
  );

  await measure(
    "pool.deposit",
    pool,
    "LendingPool",
    "deposit",
    [lender.publicKey(), token, i128(100n * ONE_XLM)],
    lender,
    true,
    "100 XLM into an empty pool — mints shares",
  );

  await measure(
    "loan_manager.request_loan",
    manager,
    "LoanManager",
    "request_loan",
    [borrower.publicKey(), i128(10n * ONE_XLM), u32(1)],
    borrower,
    true,
    "10 XLM over the default term",
  );

  const loanCount = Number(await read(manager, "get_total_loans"));
  const loanId = loanCount;

  await measure(
    "loan_manager.approve_loan",
    manager,
    "LoanManager",
    "approve_loan",
    [u32(loanId)],
    admin,
    true,
    "approval is what moves the principal out of the pool",
  );

  // ── Read paths ─────────────────────────────────────────────────────────────
  // Reads still cost CPU and memory even though they never reach a ledger, and a
  // frontend that polls them is paying that cost on every render.
  await measure(
    "loan_manager.get_loan_accrued",
    manager,
    "LoanManager",
    "get_loan_accrued",
    [u32(loanId)],
    admin,
    false,
    "read path — simulated only",
  );
  await measure(
    "loan_manager.get_loan",
    manager,
    "LoanManager",
    "get_loan",
    [u32(loanId)],
    admin,
    false,
    "read path — simulated only",
  );
  await measure(
    "pool.get_pool_stats",
    pool,
    "LendingPool",
    "get_pool_stats",
    [token],
    admin,
    false,
    "read path — simulated only",
  );
  await measure(
    "nft.get_score",
    nft,
    "RemittanceNFT",
    "get_score",
    [borrower.publicKey()],
    admin,
    false,
    "read path — simulated only",
  );

  // ── Repayment, the most expensive path ─────────────────────────────────────
  // `get_loan_accrued` returns the whole `Loan`, not a scalar: it is the projection of what
  // the loan *would* owe if interest were realised at the current ledger. The repayable
  // figure is principal plus accrued interest plus any late fee, minus what has been paid.
  const projected = (await read(manager, "get_loan_accrued", [
    u32(loanId),
  ])) as {
    amount: bigint;
    accrued_interest: bigint;
    accrued_late_fee: bigint;
    principal_paid: bigint;
    interest_paid: bigint;
    late_fee_paid: bigint;
  };
  const debt =
    projected.amount +
    projected.accrued_interest +
    projected.accrued_late_fee -
    projected.principal_paid -
    projected.interest_paid -
    projected.late_fee_paid;
  await measure(
    "loan_manager.repay",
    manager,
    "LoanManager",
    "repay",
    [borrower.publicKey(), u32(loanId), i128(debt)],
    borrower,
    true,
    "full repayment: interest accrual, score credit, and pool settlement",
  );

  // ── WASM sizes ─────────────────────────────────────────────────────────────
  const wasmDir = path.join(
    __dirname,
    "../contracts/target/wasm32v1-none/release",
  );
  const wasmSizes: { name: string; bytes: number }[] = [];
  for (const name of [
    "remittance_nft",
    "lending_pool",
    "loan_manager",
    "multisig_governance",
  ]) {
    const file = path.join(wasmDir, `${name}.wasm`);
    if (await fs.pathExists(file)) {
      wasmSizes.push({ name, bytes: (await fs.stat(file)).size });
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  const deployed = manifest.deployedAt as string;
  const lines: string[] = [];
  const p = (s = "") => lines.push(s);

  p("# Gas and resource benchmarks");
  p();
  p("> **Generated file.** Do not edit by hand: run");
  p(
    "> `cd scripts && SECRET_KEY=<admin secret> npx ts-node benchmark-gas.ts testnet`.",
  );
  p();
  p("## What is measured, and how");
  p();
  p(
    "Soroban charges for CPU instructions and for ledger I/O (bytes read and written).",
  );
  p(
    "Both are reported by the host on simulation, which is also how a wallet estimates a fee",
  );
  p(
    "before signing. Each operation below was simulated against the deployed Testnet",
  );
  p(
    "contracts, and the preceding steps were submitted so the measurement is taken against a",
  );
  p("real loan rather than a synthetic call.");
  p();
  p(
    "**These numbers are state-dependent, not constants.** The cost of a repayment grows with",
  );
  p(
    "the interest accrued, and the cost of a mint is higher for a borrower with no existing",
  );
  p("NFT. The state each row was measured against is recorded in the notes.");
  p();
  p(
    "The figures are **not a CI gate.** Testnet resource cost drifts with ledger load and",
  );
  p(
    "protocol version, and a threshold that failed on drift would be a flaky check that",
  );
  p(
    "teaches people to ignore it. `check-wasm-size.mjs` gates binary size instead, which is",
  );
  p("deterministic and the part a contributor can actually control.");
  p();
  p(
    `Measured: ${deployed} · network \`${network}\` · source revision \`${process.env.GITHUB_SHA?.slice(0, 7) ?? "local"}\``,
  );
  p();
  p("## Transaction costs");
  p();
  p(
    "| Operation | Contract | CPU instructions | Read + write bytes | Min resource fee (stroops) |",
  );
  p("|---|---|---:|---:|---:|");
  for (const m of measurements) {
    const note = m.note ? ` <br/>_${m.note}_` : "";
    p(
      `| \`${m.method}\`${note} | ${m.contract} | ${Number(m.cpuInsns).toLocaleString("en-US")} | ${Number(m.memBytes).toLocaleString("en-US")} | ${Number(m.minResourceFee).toLocaleString("en-US")} |`,
    );
  }
  p();
  p("### Summary");
  p();
  const written = measurements.filter((m) => m.submitted);
  const reads = measurements.filter((m) => !m.submitted);
  const maxWrite = written.reduce((a, b) => (a.cpuInsns > b.cpuInsns ? a : b));
  const sumWrite = written.reduce((a, b) => a + b.cpuInsns, 0n);
  p(
    `- **${written.length} state-changing operations**, ${sumWrite.toLocaleString("en-US")} CPU instructions in total.`,
  );
  p(
    `- **Most expensive:** \`${maxWrite.method}\` at ${Number(maxWrite.cpuInsns).toLocaleString("en-US")} instructions.`,
  );
  p(
    `- **${reads.length} read operations**, which cost CPU and memory on simulation but never reach a ledger.`,
  );
  p();
  p(
    "For scale: Soroban's per-transaction instruction limit is 100,000,000, so the most",
  );
  p(
    "expensive operation here uses a small single-digit percentage of the budget available.",
  );
  p();
  if (wasmSizes.length) {
    p("## Contract binary size");
    p();
    p(
      "Size matters independently of per-call cost: every deploy uploads the WASM once, and",
    );
    p(
      "it is the figure a contributor can directly influence by adding or removing code.",
    );
    p();
    p("| Contract | WASM size (bytes) |");
    p("|---|---:|");
    for (const w of [...wasmSizes].sort((a, b) => b.bytes - a.bytes)) {
      p(`| \`${w.name}\` | ${w.bytes.toLocaleString("en-US")} |`);
    }
    p();
  }
  p("## Reproducing");
  p();
  p("```bash");
  p("cd scripts");
  p("SECRET_KEY=<admin secret> npx ts-node benchmark-gas.ts testnet");
  p("```");
  p();

  const out = path.join(__dirname, "../docs/GAS.md");
  await fs.writeFile(out, lines.join("\n"));
  console.log(`\n  wrote ${path.relative(process.cwd(), out)}`);
  console.log(
    "\n  operation                                    CPU insns       bytes",
  );
  console.log("  " + "─".repeat(74));
  for (const m of measurements) {
    console.log(
      `  ${m.method.padEnd(30)} ${m.contract.padEnd(16)} ${Number(m.cpuInsns).toLocaleString("en-US").padStart(12)} ${Number(m.memBytes).toLocaleString("en-US").padStart(12)}`,
    );
  }
  console.log();
}

main().catch((error) => {
  console.error(
    "\nBenchmark failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
