#!/usr/bin/env node
/**
 * Enforce the quarantine policy in `docs/QUARANTINED-TESTS.md`.
 *
 * A skipped test is invisible. It is not counted as a failure, it is not counted as a pass, and
 * once the reason for skipping it has left the reviewer's head there is nothing left to act on.
 * The ledger is the record that stops that happening, and this script is what keeps the ledger
 * from becoming a document nobody updates:
 *
 *   1. Every row must point at a test that still exists, owned by someone, with a deadline that
 *      has not passed. Quarantine that expires is the only kind that ends.
 *   2. Every unconditional skip in the test sources must have a row. Otherwise the ledger can be
 *      satisfied while the real set of skipped tests grows behind it.
 *   3. No CI job may retry a failing test. A run that retries until green is a run whose red
 *      verdict has been overwritten, and the policy's whole purpose is that red survives.
 *
 * A skip is treated as *environment-gated*, and exempt from the ledger, when the reason it
 * carries names a condition — the database-backed suites, which CI runs. Everything else is a
 * quarantine and needs a row. The patterns for that are listed explicitly below rather than
 * inferred, so widening the exemption is an edit a reviewer can see.
 *
 * Usage:
 *   node scripts/check-quarantine.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ledgerPath = path.join(repoRoot, "docs", "QUARANTINED-TESTS.md");

const LAYERS = new Set([
  "backend",
  "frontend",
  "e2e",
  "sdk",
  "contracts",
  "integration",
]);

/**
 * Reasons that describe a condition rather than a defect.
 *
 * A suite that skips itself when there is no database is not quarantined — it runs in CI, where
 * there is one — so it is exempt. The match is on the reason text the skip carries, which is why
 * the gated suites must keep saying so.
 */
const ENVIRONMENT_GATE_PATTERNS = [
  /no database/i,
  /without (a )?database/i,
  /requires? (a )?(live|real) (database|rpc|network)/i,
  /skipped: no .*configured/i,
];

/** Files that may contain a silent retry of a failing test. */
const RETRY_SURFACES = ["frontend/playwright.config.ts", ".github/workflows"];

const errors = [];
const notes = [];

// ── The ledger ────────────────────────────────────────────────────────────────

if (!existsSync(ledgerPath)) {
  console.error(
    "docs/QUARANTINED-TESTS.md does not exist, so there is no quarantine policy.",
  );
  process.exit(1);
}

const ledgerSource = readFileSync(ledgerPath, "utf8");

function ledgerRows(source) {
  const rows = [];

  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;

    const cells = trimmed
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());

    // Skip the header and the `| --- |` separator.
    if (cells.length < 6) continue;
    if (cells.every((cell) => /^-+$/.test(cell) || cell.length === 0)) continue;
    if (cells[0] === "Test" || cells[0] === "Column") continue;

    rows.push(cells);
  }

  return rows;
}

const rows = ledgerRows(ledgerSource);

if (rows.length === 0) {
  notes.push(
    "The ledger has no rows. That is correct if nothing is quarantined right now.",
  );
}

const quarantined = [];

for (const [index, cells] of rows.entries()) {
  const [test, layer, owner, deadline, reason, tracking] = cells;
  const row = `row ${index + 1} (${test})`;

  const match = /^`([^`]+)`\s*›\s*`([^`]+)`$/.exec(test);
  if (match === null) {
    errors.push(
      `${row}: the Test cell must be \`path\` › \`test name\`, with both parts in backticks.`,
    );
    continue;
  }

  const [, file, testName] = match;

  if (!LAYERS.has(layer)) {
    errors.push(
      `${row}: layer "${layer}" is not one of ${[...LAYERS].join(", ")}.`,
    );
  }

  if (!/^@[A-Za-z0-9-]+$/.test(owner)) {
    errors.push(
      `${row}: owner "${owner}" is not a GitHub handle. Quarantine needs a person.`,
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
    errors.push(`${row}: deadline "${deadline}" is not a YYYY-MM-DD date.`);
  } else {
    const deadlineDate = new Date(`${deadline}T00:00:00Z`);
    if (Number.isNaN(deadlineDate.getTime())) {
      errors.push(`${row}: deadline "${deadline}" is not a real date.`);
    } else {
      // Compared at day granularity so the check does not go red partway through the final day.
      const today = new Date();
      const todayUtc = Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate(),
      );
      if (deadlineDate.getTime() < todayUtc) {
        errors.push(
          `${row}: the quarantine deadline ${deadline} has passed. Either fix the test and ` +
            `delete the row, or renew it with a new date and a reason that says what changed.`,
        );
      }
    }
  }

  if (reason.length < 20 || /^flaky\.?$/i.test(reason)) {
    errors.push(
      `${row}: the reason must name the cause. "flaky" is a description of the symptom, not a ` +
        `reason, and it cannot be acted on.`,
    );
  }

  if (!/^(#[0-9]+|https?:\/\/\S+)$/.test(tracking)) {
    errors.push(
      `${row}: tracking "${tracking}" must be an issue reference like #123.`,
    );
  }

  const absolute = path.join(repoRoot, file);
  if (!existsSync(absolute)) {
    errors.push(`${row}: ${file} does not exist.`);
    continue;
  }

  const contents = readFileSync(absolute, "utf8");
  if (!contents.includes(testName)) {
    errors.push(
      `${row}: ${file} does not contain a test named "${testName}". The ledger and the code ` +
        `have drifted apart.`,
    );
    continue;
  }

  quarantined.push({ file, testName });
}

// ── Every skip in the sources is accounted for ────────────────────────────────

/**
 * Unconditional skips, as opposed to environment-gated ones.
 *
 * Only a literal skip target can be read statically: `test.skip("name", …)` names a test this
 * script can match to the ledger, while `describe.skip(someVariable, …)` is resolved at runtime
 * and cannot be. A template or variable target is therefore treated as gated by construction,
 * which is also how the database suites are written — they build their description from the
 * presence of a connection.
 */
const SKIP_PATTERNS = [
  /^\s*(?:test|it|describe)\.skip\(\s*(["'`])([^"'`]+)\1/gm,
  /^\s*#\[ignore(?:\([^)]*\))?\]/gm,
];

const SKIP_SCAN_DIRS = [
  "backend/src",
  "frontend/e2e",
  "frontend/src",
  "packages",
  "contracts",
];

function* sourceFiles() {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);

  for (const file of tracked) {
    if (!SKIP_SCAN_DIRS.some((dir) => file.startsWith(`${dir}/`))) continue;
    if (!/\.(ts|tsx|js|mjs|rs)$/.test(file)) continue;
    if (/\.d\.ts$/.test(file)) continue;
    yield file;
  }
}

const untrackedSkips = [];

for (const file of sourceFiles()) {
  let contents;
  try {
    contents = readFileSync(path.join(repoRoot, file), "utf8");
  } catch {
    continue;
  }

  for (const pattern of SKIP_PATTERNS) {
    for (const skip of contents.matchAll(pattern)) {
      const name = skip[2];
      const reason = skip[0];

      if (
        name !== undefined &&
        ENVIRONMENT_GATE_PATTERNS.some((gate) => gate.test(reason))
      ) {
        continue;
      }

      // The ledger may name the file (for a skipped whole suite) or the individual test.
      const listed = quarantined.some(
        (row) =>
          row.file === file &&
          (name === undefined ||
            row.testName === name ||
            contents.includes(row.testName)),
      );

      if (!listed) {
        const label =
          name === undefined
            ? `${file} (a Rust \`#[ignore]\`)`
            : `${file} › ${name}`;
        untrackedSkips.push(label);
      }
    }
  }
}

if (untrackedSkips.length > 0) {
  errors.push(
    `${untrackedSkips.length} test(s) are skipped in code with no row in ` +
      `docs/QUARANTINED-TESTS.md:\n` +
      untrackedSkips.map((label) => `    ${label}`).join("\n") +
      `\n  Fix the test, or quarantine it with an owner and a deadline.`,
  );
}

// ── Nothing retries a failing test in CI ──────────────────────────────────────

const playwrightConfig = path.join(
  repoRoot,
  "frontend",
  "playwright.config.ts",
);

if (existsSync(playwrightConfig)) {
  const config = readFileSync(playwrightConfig, "utf8");
  const retries = /retries:\s*([^,\n]+)/.exec(config);

  if (retries === null) {
    notes.push(
      "playwright.config.ts sets no retries, which defaults to zero. Good.",
    );
  } else if (!/^0\b/.test(retries[1].trim())) {
    errors.push(
      `frontend/playwright.config.ts sets \`retries: ${retries[1].trim()}\`. A retry in CI turns ` +
        `a failing test into a green run, which is the one outcome the quarantine policy exists ` +
        `to prevent. Set it to 0 and quarantine the tests that need it.`,
    );
  }
}

const workflowsDir = path.join(repoRoot, ".github", "workflows");

if (existsSync(workflowsDir)) {
  for (const workflow of execFileSync("git", ["ls-files", workflowsDir], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))) {
    const contents = readFileSync(path.join(repoRoot, workflow), "utf8");

    // A test step that retries. `--retry` on a curl health check is not a test retry, so the
    // pattern is anchored on commands that run a test suite.
    const retryingTestStep =
      /(jest|playwright|pytest|cargo test|npm (run )?test)[^\n]*--retries?[= ]\d+/i.exec(
        contents,
      );

    if (retryingTestStep !== null) {
      errors.push(
        `${workflow} passes a retry flag to a test command:\n    ${retryingTestStep[0].trim()}\n` +
          `  A test that only passes on the second attempt has failed.`,
      );
    }

    if (/^\s*max_attempts:\s*[2-9]/m.test(contents)) {
      errors.push(
        `${workflow} sets max_attempts above 1 on a job, which retries the whole job — including ` +
          `its tests — invisibly.`,
      );
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

for (const note of notes) console.warn(`Note: ${note}\n`);

if (errors.length > 0) {
  for (const error of errors) console.error(`\n✖ ${error}\n`);
  console.error(`Quarantine policy check failed: ${errors.length} problem(s).`);
  process.exit(1);
}

const deadlines = rows
  .map((cells) => cells[3])
  .sort()
  .filter((deadline) => /^\d{4}-\d{2}-\d{2}$/.test(deadline));

console.log(
  `Quarantine policy holds: ${quarantined.length} test(s) quarantined, ` +
    `${quarantined.length === 0 ? "no deadline" : `earliest deadline ${deadlines[0]}`}, ` +
    `no test retried in CI.`,
);
