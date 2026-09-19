#!/usr/bin/env node
/**
 * Fail when a contract's `## Errors` table and its `#[contracterror]` enum
 * disagree.
 *
 * Why this exists
 * ---------------
 * A contract README's error table is what an integrator reads to decide whether a
 * failure is worth retrying. Nothing kept it in step with the enum, so it drifts
 * the first time a variant is added: the code is real on chain, `Error(Contract,
 * #19)` is decodable, and the README says nothing about it. The reverse drifts
 * too, and is worse — documenting a variant that was removed sends a caller down
 * a branch that can never be taken.
 *
 * What it checks
 * --------------
 * For each contract listed below:
 *   - every variant in the enum appears exactly once in the README's `## Errors`
 *     section;
 *   - every row in that section names a variant that still exists;
 *   - every numeric code is accounted for exactly once, either as a variant or as
 *     an explicit `*reserved*` row. A silently missing number is how a reused code
 *     stops being noticed.
 *
 * It is a text check on purpose: it needs a checkout and Node, nothing else, so it
 * runs in the same job as the other repository-wide policy checks rather than
 * waiting on a Rust toolchain.
 *
 * Usage
 * -----
 *   node scripts/check-contract-error-docs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

/**
 * Contracts that must document every error. `loan_manager` and
 * `multisig_governance` are deliberately absent: their READMEs have no error
 * table yet, and adding a requirement here before the table exists would fail CI
 * for a gap this script was not written to close. The full variant list for all
 * four contracts already lives in `docs/ERROR_CODES.md`.
 */
const CONTRACTS = [
  { dir: "lending_pool", enumName: "PoolError" },
  { dir: "remittance_nft", enumName: "NftError" },
];

function readEnumVariants(contract) {
  const sourcePath = path.join(REPO_ROOT, "contracts", contract.dir, "src", "lib.rs");
  const source = fs.readFileSync(sourcePath, "utf8");

  const enumMatch = /#\[contracterror\][\s\S]*?pub enum (\w+)\s*\{([\s\S]*?)\n\}/.exec(source);
  if (!enumMatch) {
    throw new Error(`No #[contracterror] enum found in ${path.relative(REPO_ROOT, sourcePath)}`);
  }

  const [, name, body] = enumMatch;
  if (name !== contract.enumName) {
    throw new Error(
      `${contract.dir}: expected the error enum to be named ${contract.enumName}, found ${name}`,
    );
  }

  const variants = new Map();
  for (const [, variant, code] of body.matchAll(/^\s*(\w+)\s*=\s*(\d+)\s*,/gm)) {
    variants.set(Number(code), variant);
  }

  return variants;
}

function readDocumentedCodes(contract) {
  const readmePath = path.join(REPO_ROOT, "contracts", contract.dir, "README.md");
  const readme = fs.readFileSync(readmePath, "utf8");
  const relative = path.relative(REPO_ROOT, readmePath);

  // The section runs until the next `## ` heading, or to the end of the file when
  // it is the last one.
  const lines = readme.split("\n");
  const start = lines.findIndex((line) => /^## Errors\s*$/.test(line));
  if (start === -1) {
    throw new Error(
      `${relative} has no "## Errors" section. Every contract with an error enum must document it.`,
    );
  }

  const sectionLines = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^## /.test(lines[index])) break;
    sectionLines.push(lines[index]);
  }

  const documented = new Map();
  const duplicates = [];

  for (const line of sectionLines) {
    const row = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|/.exec(line);
    if (!row) continue;

    const code = Number(row[1]);
    const cell = row[2];
    const variant = /^`(\w+)`$/.exec(cell)?.[1] ?? null;

    if (!variant && !/^\*reserved\*$/.test(cell)) continue;

    if (documented.has(code)) duplicates.push(code);
    documented.set(code, variant);
  }

  return { documented, duplicates, relative };
}

function checkContract(contract) {
  const variants = readEnumVariants(contract);
  const { documented, duplicates, relative } = readDocumentedCodes(contract);
  const problems = [];

  for (const code of duplicates) {
    problems.push(`${relative}: code ${code} appears in more than one row.`);
  }

  for (const [code, variant] of variants) {
    if (!documented.has(code)) {
      problems.push(
        `${relative}: \`${variant}\` = ${code} is in the enum but has no row. ` +
          "Document it, or mark the code reserved with a reason.",
      );
      continue;
    }

    const documentedVariant = documented.get(code);
    if (documentedVariant !== variant) {
      problems.push(
        `${relative}: code ${code} is documented as ` +
          `${documentedVariant === null ? "reserved" : `\`${documentedVariant}\``}, ` +
          `but the enum has \`${variant}\`.`,
      );
    }
  }

  for (const [code, variant] of documented) {
    // A `*reserved*` row is the deliberate record of a gap, so it is expected not
    // to be a variant. Only a named variant that no longer exists is a problem.
    if (variant === null) continue;

    if (!variants.has(code)) {
      problems.push(
        `${relative}: code ${code} is documented as \`${variant}\` but is not in the enum. ` +
          "Remove the row, or mark the code reserved with the reason it must be held.",
      );
    }
  }

  // Every integer between the lowest and highest code has to be accounted for on
  // one side or the other; a hole nobody wrote down is how a number gets reused.
  const codes = new Set([...variants.keys(), ...documented.keys()]);
  if (codes.size > 0) {
    const lowest = Math.min(...codes);
    const highest = Math.max(...codes);
    for (let code = lowest; code <= highest; code += 1) {
      const inEnum = variants.has(code);
      const inDocs = documented.has(code);
      if (inEnum && !inDocs) continue; // already reported above
      if (!inEnum && !inDocs) {
        problems.push(
          `${relative}: code ${code} is neither a variant nor a reserved row. ` +
            "Account for it explicitly so the gap is recorded rather than inferred.",
        );
      }
    }
  }

  return problems;
}

function main() {
  const problems = [];

  for (const contract of CONTRACTS) {
    try {
      problems.push(...checkContract(contract));
    } catch (error) {
      problems.push(error.message);
    }
  }

  if (problems.length > 0) {
    console.error("Contract error documentation is out of step:\n");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      "\nFix the README table, or the enum comment for a reserved code. " +
        "docs/ERROR_CODES.md holds the longer guard-level description.",
    );
    process.exit(1);
  }

  console.log(
    `Contract error documentation is current (${CONTRACTS.map((c) => c.enumName).join(", ")}).`,
  );
}

main();
