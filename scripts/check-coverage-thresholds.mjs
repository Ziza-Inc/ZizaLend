#!/usr/bin/env node

/**
 * check-coverage-thresholds.mjs
 *
 * Enforces the coverage floors in `<project>/coverage-thresholds.json` against the summary Jest
 * writes, and refuses a floor that has been lowered without saying so.
 *
 * Coverage that is measured but not enforced trends down, and the report is only consulted during
 * an audit — by which point the cheap fix is long gone. The floors live in a committed file so
 * lowering one is a line in a diff a reviewer sees, and the ratchet check turns "someone should
 * notice" into a failed run: a floor below its value on the base branch has to carry a reason in
 * `allowFloorDecrease`, which is the explicit change that makes an exception legitimate.
 *
 * Usage:
 *   node scripts/check-coverage-thresholds.mjs --project backend
 *   node scripts/check-coverage-thresholds.mjs --project frontend --base origin/main
 *   node scripts/check-coverage-thresholds.mjs --project backend --summary $GITHUB_STEP_SUMMARY
 *
 * Exits 1 when a floor is missed or lowered without a reason.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METRICS = ['statements', 'branches', 'functions', 'lines'];

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { project: null, base: null, summary: null };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--project') args.project = argv[++index];
    else if (value === '--base') args.base = argv[++index];
    else if (value === '--summary') args.summary = argv[++index];
    else if (value === '--help') args.help = true;
    else {
      console.error(`Unknown argument: ${value}`);
      process.exit(2);
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.project) {
  console.log(
    'Usage: node scripts/check-coverage-thresholds.mjs --project <backend|frontend> ' +
      '[--base <git-ref>] [--summary <path>]',
  );
  process.exit(args.help ? 0 : 2);
}

const projectDir = join(root, args.project);
const floorsPath = join(projectDir, 'coverage-thresholds.json');
const summaryPath = join(projectDir, 'coverage', 'coverage-summary.json');

if (!existsSync(floorsPath)) {
  console.error(`❌ ${args.project}/coverage-thresholds.json not found.`);
  process.exit(1);
}

if (!existsSync(summaryPath)) {
  console.error(
    `❌ ${args.project}/coverage/coverage-summary.json not found — run the coverage suite first ` +
      `(npm run test:coverage in ${args.project}/). The \`json-summary\` reporter writes it.`,
  );
  process.exit(1);
}

const thresholds = JSON.parse(readFileSync(floorsPath, 'utf8'));
const floors = thresholds.floors ?? {};
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));

/**
 * Aggregate the files under one entry of the floors file.
 *
 * A key ending in `/` is a directory (or a path prefix) and covers every file beneath it; `global`
 * is the whole run. Summing covered and total counts rather than averaging per-file percentages is
 * deliberate: an average lets a large well-covered file hide a small untouched one.
 */
function measure(key) {
  if (key === 'global') {
    const total = summary.total;
    return Object.fromEntries(METRICS.map((metric) => [metric, total[metric].pct]));
  }

  const counts = Object.fromEntries(METRICS.map((metric) => [metric, [0, 0]]));

  for (const [file, entry] of Object.entries(summary)) {
    if (file === 'total') continue;

    const relative = file.slice(root.length + 1);
    if (!relative.includes(key)) continue;

    for (const metric of METRICS) {
      counts[metric][0] += entry[metric].covered;
      counts[metric][1] += entry[metric].total;
    }
  }

  return Object.fromEntries(
    METRICS.map((metric) => {
      const [covered, total] = counts[metric];
      return [metric, total === 0 ? 100 : Math.round((covered / total) * 10000) / 100];
    }),
  );
}

function format(pct) {
  return `${pct.toFixed(2)}%`;
}

const violations = [];
const rows = [];

for (const [key, metrics] of Object.entries(floors)) {
  const measured = measure(key);

  for (const metric of METRICS) {
    const floor = metrics[metric];
    if (floor === undefined) continue;

    const actual = measured[metric];
    const ok = actual + 1e-9 >= floor;
    if (!ok) violations.push(`${key} ${metric}: ${format(actual)} < ${floor}%`);

    rows.push({ key, metric, floor, actual, ok });
  }
}

// ── Ratchet ───────────────────────────────────────────────────────────────────
// A floor may only go up. Lowering one is allowed, but only as a stated decision: the entry in
// `allowFloorDecrease` is what a reviewer reads, and its absence is what makes this fail.
const lowered = [];

if (args.base) {
  let baseFile = null;

  try {
    baseFile = execFileSync(
      'git',
      ['show', `${args.base}:${args.project}/coverage-thresholds.json`],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    console.warn(
      `⚠️  Could not read ${args.project}/coverage-thresholds.json from ${args.base} — ` +
        'skipping the ratchet comparison. Fetch the base ref for it to run.',
    );
  }

  if (baseFile) {
    const baseFloors = JSON.parse(baseFile).floors ?? {};
    const allowed = thresholds.allowFloorDecrease ?? {};

    for (const [key, metrics] of Object.entries(floors)) {
      for (const metric of METRICS) {
        const floor = metrics[metric];
        const baseFloor = baseFloors[key]?.[metric];
        if (floor === undefined || baseFloor === undefined) continue;
        if (floor >= baseFloor) continue;

        const reason = allowed[`${key} ${metric}`] ?? allowed[key];
        if (typeof reason === 'string' && reason.trim() !== '') {
          console.warn(
            `ℹ️  ${key} ${metric} lowered from ${baseFloor}% to ${floor}%: ${reason.trim()}`,
          );
          continue;
        }

        lowered.push(`${key} ${metric}: ${baseFloor}% → ${floor}% (no allowFloorDecrease reason)`);
      }
    }
  }
}

if (args.summary) {
  const lines = [
    `## ${args.project} coverage`,
    '',
    '| Scope | Metric | Measured | Floor | |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (row) => `| \`${row.key}\` | ${row.metric} | ${format(row.actual)} | ${row.floor}% | ${row.ok ? '✅' : '❌'} |`,
    ),
    '',
    'Floors live in `' + args.project + '/coverage-thresholds.json` and may only go up; see',
    '`docs/TESTING.md`.',
    '',
  ];

  const markdown = lines.join('\n');
  if (args.summary === '-') console.log(markdown);
  else appendFileSync(args.summary, markdown);
}

if (violations.length > 0 || lowered.length > 0) {
  if (violations.length > 0) {
    console.error(`\n❌ ${args.project}: coverage below the floors in coverage-thresholds.json:`);
    for (const violation of violations) console.error(`   - ${violation}`);
    console.error(
      '\n   Add the test or lower the floor deliberately — the point is that either is a decision,\n' +
        '   not an accident.',
    );
  }

  if (lowered.length > 0) {
    console.error(`\n❌ ${args.project}: a coverage floor was lowered without a stated reason:`);
    for (const entry of lowered) console.error(`   - ${entry}`);
    console.error('\n   Add a reason under `allowFloorDecrease` in coverage-thresholds.json.');
  }

  process.exit(1);
}

console.log(
  `✅ ${args.project}: ${rows.length} coverage floors met` +
    (args.base ? ' and no floor lowered.' : '.'),
);
