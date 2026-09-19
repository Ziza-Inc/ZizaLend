#!/usr/bin/env node
/**
 * Verify the dependency review actually covers this repository, and that its licence policy is a
 * decision rather than a default.
 *
 * The repository has seven lockfiles across two ecosystems — npm manifests for the root
 * workspace, `backend`, `frontend`, `scripts`, and `scripts/video`, and `Cargo.lock` for the
 * contracts workspace and its fuzz target. A review that silently covered only the root
 * `package-lock.json` would report green on a vulnerable dependency added to the backend, which
 * is precisely the failure this check exists to make impossible.
 *
 * Four questions, each answered from a different artefact:
 *
 *   1. Is every lockfile in the repository mapped to an ecosystem? A lockfile this script does
 *      not recognise is an error rather than a silent skip, so adding a fifth package manager is
 *      a deliberate decision instead of an unnoticed gap.
 *   2. Does `dependency-review.yml` carry the policy shape that makes the review act on what it
 *      finds — a `pull_request` trigger, a job timeout, a severity floor, and an explicit
 *      licence allowlist rather than the action's implicit default?
 *   3. Does that allowlist permit every licence already in the dependency graph? A policy that
 *      is stricter than the tree in use fails the next unrelated pull request.
 *   4. Does it still reject the licences it is meant to reject? An allowlist so permissive that
 *      it permits AGPL is not a policy.
 *
 * Questions 3 and 4 read licences from the lockfiles themselves: every lockfile in the npm
 * ecosystem records a `license` field, so the check needs no install and no network. The cargo
 * registry is consulted when it is present (`--cargo-registry`), and skipped with a note when it
 * is not, so the script is useful both in CI after a fetch and on a bare checkout.
 *
 * Usage:
 *   node scripts/check-dependency-review-scope.mjs [--cargo-registry <dir>]
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Lockfilenames this repository is expected to use, mapped to the ecosystem the dependency
 * graph files them under. The dependency review action does not need to be told which paths to
 * read — it reviews the pull request's diff through the dependency graph, which indexes every
 * supported manifest in the repository — so the mapping here is what "every lockfile" means.
 */
const LOCKFILE_ECOSYSTEMS = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "yarn.lock": "npm",
  "pnpm-lock.yaml": "npm",
  "Cargo.lock": "cargo",
};

/** Ecosystems the dependency review action can read from the dependency graph. */
const ECOSYSTEMS_COVERED_BY_THE_ACTION = new Set(["npm", "cargo"]);

/** Licences the repository's own dependencies use, and that the policy must therefore allow. */
const REQUIRED_ALLOWED = [
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "MPL-2.0",
  "BlueOak-1.0.0",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
];

/**
 * Licences the policy must not permit.
 *
 * Strong copyleft, network copyleft, and non-commercial terms. `FSL-1.1-MIT` is not in this list
 * even though its terms restrict competing use: `@sentry/cli` already carries it, and the check
 * below fails if the allowlist is stricter than the tree in use. It is allowed because it is
 * already a transitive dependency, not because it is a licence this project seeks out — which is
 * why the workflow names it in the allowlist with that reason written down rather than folding
 * it into the permissive block.
 */
const MUST_BE_REJECTED = [
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "GPL-3.0-only",
  "GPL-2.0-only",
  "SSPL-1.0",
  "BUSL-1.1",
  "CC-BY-NC-4.0",
  "OSL-3.0",
];

const errors = [];
const notes = [];

// ── 1. Every lockfile is mapped to an ecosystem ───────────────────────────────

function findLockfiles() {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);

  const lockfiles = [];
  const unmapped = [];

  for (const file of tracked) {
    const name = path.basename(file);
    const ecosystem = LOCKFILE_ECOSYSTEMS[name];
    if (ecosystem === undefined) continue;

    if (
      name === "package-lock.json" ||
      name.endsWith(".lock") ||
      name.endsWith(".yaml")
    ) {
      lockfiles.push({ file, ecosystem });
    }
  }

  // Anything lockfile-shaped that the table does not name is a gap, not a skip: a new package
  // manager would otherwise be added without anyone deciding its dependencies are reviewed.
  const knownNames = new Set(Object.keys(LOCKFILE_ECOSYSTEMS));
  const lockfilePattern =
    /(^|\.)(lock|lockfile|shrinkwrap)$|lock\.(json|yaml|yml)$/;

  for (const file of tracked) {
    const name = path.basename(file);
    if (knownNames.has(name)) continue;
    if (lockfilePattern.test(name)) unmapped.push(file);
  }

  return { lockfiles, unmapped };
}

const { lockfiles, unmapped } = findLockfiles();

if (lockfiles.length === 0) {
  errors.push(
    "Found no lockfiles. The check is looking in the wrong place and would pass vacuously.",
  );
}

if (unmapped.length > 0) {
  errors.push(
    `Unrecognised lockfile(s) — add them to LOCKFILE_ECOSYSTEMS once you have decided which ` +
      `ecosystem reviews them:\n${unmapped.map((file) => `    ${file}`).join("\n")}`,
  );
}

const ecosystems = new Set(lockfiles.map(({ ecosystem }) => ecosystem));

for (const ecosystem of ecosystems) {
  if (!ECOSYSTEMS_COVERED_BY_THE_ACTION.has(ecosystem)) {
    errors.push(
      `Ecosystem "${ecosystem}" is not supported by the dependency review action's dependency ` +
        `graph, so its lockfiles are not reviewed.`,
    );
  }
}

// ── 2. The workflow carries the policy shape ──────────────────────────────────

const workflowPath = path.join(
  repoRoot,
  ".github",
  "workflows",
  "dependency-review.yml",
);
const workflow = existsSync(workflowPath)
  ? readFileSync(workflowPath, "utf8")
  : undefined;

if (workflow === undefined) {
  errors.push(".github/workflows/dependency-review.yml does not exist.");
}

const workflowBody = workflow ?? "";

if (!/^\s{2}pull_request:/m.test(workflowBody)) {
  errors.push("dependency-review.yml does not trigger on pull_request.");
}

// The branch may be written as a list (`- main`) or in flow form (`[main]`).
if (
  !/pull_request:\s*\n\s{4}branches:\s*(\n\s{6}- main\b|\[\s*main\s*\])/m.test(
    workflowBody,
  )
) {
  notes.push(
    "dependency-review.yml triggers on pull_request but not specifically for `main`.",
  );
}

if (!/^\s+timeout-minutes:/m.test(workflowBody)) {
  errors.push("dependency-review.yml has no timeout-minutes on its job.");
}

const severityMatch = /fail-on-severity:\s*(\S+)/.exec(workflowBody);
if (severityMatch === null) {
  errors.push(
    "dependency-review.yml does not set fail-on-severity, so it only reports.",
  );
} else if (severityMatch[1] !== "high" && severityMatch[1] !== "critical") {
  errors.push(
    `dependency-review.yml fails only at severity "${severityMatch[1]}", which is lower than ` +
      `this repository's floor of "high".`,
  );
}

if (/^\s+deny-licenses:/m.test(workflowBody)) {
  errors.push(
    "dependency-review.yml still uses deny-licenses. The policy is an allowlist: every licence " +
      "not named in allow-licenses is refused, so the two lists must not both be present.",
  );
}

// ── 3 & 4. The allowlist is sound against real dependency metadata ─────────────

function extractAllowlist(body) {
  const block = /^\s+allow-licenses:\s*\|?\s*\n((?:\s{10,}[^\n]*\n?)*)/m.exec(
    body,
  );
  if (block === null) return undefined;
  const entries = block[1]
    .split("\n")
    .flatMap((line) => line.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith("#"));
  return entries;
}

const allowlist = extractAllowlist(workflowBody);

if (allowlist === undefined || allowlist.length === 0) {
  errors.push(
    "dependency-review.yml declares no allow-licenses list. Without one the action falls back " +
      "to reporting every licence it sees, which is not a policy anybody has agreed to.",
  );
}

const allowed = new Set(allowlist ?? []);

/**
 * Evaluate one SPDX licence expression against the allowlist.
 *
 * `OR` is satisfied by either side, `AND` requires both, and `WITH` requires the exception to
 * be named in the allowlist (an exception is a term, not a synonym for the bare licence).
 * Parentheses nest. The legacy `MIT/Apache-2.0` form, which crates still publish, is read as an
 * `OR` — that is what it meant when it was written.
 */
function isPermitted(expression) {
  const tokenise = (input) =>
    input
      .replace(/\(/g, " ( ")
      .replace(/\)/g, " ) ")
      .replace(/\//g, " OR ")
      .split(/\s+/)
      .filter((token) => token.length > 0);

  const tokens = tokenise(expression);

  const parseOr = (() => {
    let index = 0;

    const peek = () => tokens[index];

    const parsePrimary = () => {
      const token = tokens[index];
      if (token === "(") {
        index += 1;
        const value = parseOr();
        if (tokens[index] !== ")")
          throw new Error(`unbalanced parentheses in "${expression}"`);
        index += 1;
        return value;
      }
      index += 1;
      // `WITH` binds a licence to an exception; the pair is matched as a unit.
      if (tokens[index] === "WITH") {
        index += 1;
        const exception = tokens[index];
        index += 1;
        return allowed.has(`${token} WITH ${exception}`);
      }
      return allowed.has(token);
    };

    const parseAnd = () => {
      let value = parsePrimary();
      while (peek() === "AND") {
        index += 1;
        value = parsePrimary() && value;
      }
      return value;
    };

    return () => {
      let value = parseAnd();
      while (peek() === "OR") {
        index += 1;
        const right = parseAnd();
        value = value || right;
      }
      // A nested call stops at its closing parenthesis rather than at the end of the input;
      // the caller that opened it consumes the `)` and checks its position itself.
      if (index < tokens.length && peek() !== ")") {
        throw new Error(
          `could not parse "${expression}" at token ${index} ("${tokens[index]}")`,
        );
      }
      return value;
    };
  })();

  return parseOr();
}

/** Every npm licence recorded in the repository's lockfiles, with one example package each. */
function npmLicences() {
  const seen = new Map();

  for (const { file, ecosystem } of lockfiles) {
    if (ecosystem !== "npm") continue;
    const lock = JSON.parse(readFileSync(path.join(repoRoot, file), "utf8"));

    for (const [name, entry] of Object.entries(lock.packages ?? {})) {
      if (entry.license === undefined) continue;
      if (!seen.has(entry.license)) {
        seen.set(entry.license, `${name || file} (${file})`);
      }
    }
  }

  return seen;
}

const cargoRegistryFlag = process.argv.indexOf("--cargo-registry");
const cargoRegistry =
  cargoRegistryFlag === -1
    ? [process.env.CARGO_HOME, path.join(process.env.HOME ?? "", ".cargo")]
        .filter(Boolean)
        .map((base) => path.join(base, "registry", "src"))
        .find((candidate) => existsSync(candidate))
    : process.argv[cargoRegistryFlag + 1];

/** Every licence declared by a crate in the local cargo registry, when one is available. */
function cargoLicences() {
  const seen = new Map();

  if (cargoRegistry === undefined || !existsSync(cargoRegistry)) {
    return seen;
  }

  for (const index of readdirSync(cargoRegistry)) {
    const indexDir = path.join(cargoRegistry, index);
    let crates;
    try {
      crates = readdirSync(indexDir);
    } catch {
      continue;
    }

    for (const crate of crates) {
      let manifest;
      try {
        manifest = readFileSync(
          path.join(indexDir, crate, "Cargo.toml"),
          "utf8",
        );
      } catch {
        continue;
      }

      const match = /^license\s*=\s*"([^"]+)"/m.exec(manifest);
      if (match === null) continue;
      if (!seen.has(match[1])) seen.set(match[1], crate);
    }
  }

  return seen;
}

if (cargoRegistry === undefined || !existsSync(cargoRegistry)) {
  notes.push(
    "No cargo registry found, so only the npm side of the allowlist was checked against real " +
      "metadata. Pass --cargo-registry after `cargo fetch` to cover the crates too.",
  );
}

const observed = new Map([...npmLicences(), ...cargoLicences()]);

if (observed.size === 0) {
  errors.push(
    "Read no licence metadata from any lockfile. The policy check would pass vacuously.",
  );
}

const notAllowed = [];

for (const [expression, example] of observed) {
  let permitted;
  try {
    permitted = isPermitted(expression);
  } catch (error) {
    errors.push(
      `Could not evaluate the licence expression "${expression}" (${example}): ${error.message}`,
    );
    continue;
  }

  if (!permitted) notAllowed.push(`${expression} — e.g. ${example}`);
}

if (notAllowed.length > 0) {
  errors.push(
    `The allowlist does not permit ${notAllowed.length} licence(s) already in the dependency ` +
      `graph, so the next pull request touching those packages would fail the review:\n` +
      notAllowed.map((line) => `    ${line}`).join("\n"),
  );
}

for (const licence of REQUIRED_ALLOWED) {
  if (!allowed.has(licence)) {
    errors.push(
      `The allowlist omits "${licence}", which this repository's dependencies rely on. ` +
        `Removing it would fail the review on the next dependency update.`,
    );
  }
}

const wrongfullyAllowed = MUST_BE_REJECTED.filter((licence) =>
  isPermitted(licence),
);

if (wrongfullyAllowed.length > 0) {
  errors.push(
    `The allowlist permits ${wrongfullyAllowed.length} licence(s) it must refuse: ` +
      `${wrongfullyAllowed.join(", ")}. An allowlist that permits these is not a policy.`,
  );
}

// ── Report ────────────────────────────────────────────────────────────────────

for (const note of notes) console.warn(`Note: ${note}\n`);

if (errors.length > 0) {
  for (const error of errors) console.error(`\n✖ ${error}\n`);
  console.error(
    `Dependency review scope check failed: ${errors.length} problem(s).`,
  );
  process.exit(1);
}

const byEcosystem = [...ecosystems].sort().join(", ");
console.log(
  `Dependency review covers ${lockfiles.length} lockfile(s) across ${ecosystems.size} ` +
    `ecosystem(s) (${byEcosystem}); allowlist validated against ${observed.size} licence ` +
    `expression(s) in use and ${MUST_BE_REJECTED.length} that must be refused.`,
);
