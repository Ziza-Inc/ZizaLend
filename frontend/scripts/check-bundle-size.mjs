#!/usr/bin/env node
/**
 * Fail the build when a route ships more client JavaScript than its budget.
 *
 * Why this exists
 * ---------------
 * The frontend has charts, a wallet SDK and several form libraries, and nothing
 * measured any of them. The target user is on a slow connection, which is
 * exactly the connection where an extra 200 KB is the difference between a page
 * and a blank screen, so the cost was being discovered in production instead of
 * on the pull request that added the dependency.
 *
 * How it measures
 * ---------------
 * Next's client-reference manifest is written per route and lists every chunk
 * that route's client components need. Summing the gzipped size of those chunks
 * approximates the bytes a first visit transfers, and it is derived from the
 * build output rather than from a hand-maintained list, so it follows the real
 * dependency graph.
 *
 * Gzip is used because that is what the browser actually receives; raw byte
 * counts reward minification that changes nothing over the wire.
 *
 * The numbers include shared chunks (`rootMainFiles`) that the manifest lists
 * for every route, which is why the budgets are per-route rather than a single
 * global limit: a route that adds a chart library should fail only itself.
 *
 * Usage
 * -----
 *   npm run build && node scripts/check-bundle-size.mjs
 *   node scripts/check-bundle-size.mjs --update   # rewrite measured budgets
 *
 * Requires a completed `next build`; it reads `.next/`.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, "..");
const NEXT_DIR = path.join(FRONTEND_DIR, ".next");
const SERVER_APP_DIR = path.join(NEXT_DIR, "server", "app");
const BUDGET_FILE = path.join(FRONTEND_DIR, "bundle-budget.json");

/** Matches `/_next/static/chunks/<name>.js` inside a manifest. */
const CHUNK_PATTERN = /\/_next\/static\/chunks\/[A-Za-z0-9_-]+\.js/g;
/** Matches the `globalThis.__RSC_MANIFEST["/<route>/page"]` key. */
const ROUTE_PATTERN = /__RSC_MANIFEST\["([^"]+)"\]/;

const gzipSizeCache = new Map();

function gzipSizeBytes(chunkUrl) {
  if (gzipSizeCache.has(chunkUrl)) return gzipSizeCache.get(chunkUrl);

  const file = path.join(NEXT_DIR, chunkUrl.replace(/^\/_next\//, ""));
  let size;
  if (fs.existsSync(file)) {
    size = zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
  } else {
    // A manifest can name a chunk that the current build did not emit (a stale
    // manifest from an earlier build, for instance). Treating it as zero keeps
    // the check honest about what it can see and avoids a false failure.
    size = 0;
  }

  gzipSizeCache.set(chunkUrl, size);
  return size;
}

function findManifests(dir, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findManifests(full, found);
    } else if (entry.name.endsWith("_client-reference-manifest.js")) {
      found.push(full);
    }
  }

  return found;
}

function measureRoutes() {
  if (!fs.existsSync(SERVER_APP_DIR)) {
    console.error(
      `No build output at ${path.relative(process.cwd(), SERVER_APP_DIR)}.\n` +
        "Run `npm run build` first — this check measures the emitted bundle, not the source.",
    );
    process.exit(1);
  }

  const measured = new Map();

  for (const manifest of findManifests(SERVER_APP_DIR)) {
    const source = fs.readFileSync(manifest, "utf8");
    const routeMatch = ROUTE_PATTERN.exec(source);
    if (!routeMatch) continue;

    // The manifest key is `/<route>/page`; keep directories as directories
    // (`/[locale]`), and collapse the index page back to `/`.
    const route = routeMatch[1].replace(/\/page$/, "") || "/";

    const chunks = measured.get(route) ?? new Set();
    for (const [chunk] of source.matchAll(CHUNK_PATTERN)) chunks.add(chunk);
    measured.set(route, chunks);
  }

  return measured;
}

function kilobytes(bytes) {
  return bytes / 1024;
}

function formatKb(bytes) {
  return `${kilobytes(bytes).toFixed(1)} KB`;
}

function loadBudgets() {
  if (!fs.existsSync(BUDGET_FILE)) return null;
  return JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
}

function updateBudgets(measured) {
  // Rewritten a little above the measurement so a budget records what the route
  // ships today plus deliberate room to grow, rather than a round number that
  // happens to pass.
  const HEADROOM = 1.1;

  const budget = {
    $comment:
      "Per-route first-load JavaScript budgets in KB (gzipped), enforced by " +
      "frontend/scripts/check-bundle-size.mjs. Each value is the measured size " +
      "plus 10% headroom, so the check fails on a real regression rather than on " +
      "ordinary churn. Raise a route's budget deliberately, in the same pull " +
      "request that grows it, and say why in the description.",
    defaultBudgetKb: 0,
    routes: {},
  };

  const sizes = [...measured.entries()]
    .map(([route, chunks]) => {
      let total = 0;
      for (const chunk of chunks) total += gzipSizeBytes(chunk);
      return [route, total];
    })
    .sort((a, b) => b[1] - a[1]);

  for (const [route, total] of sizes) {
    budget.routes[route] = Number((kilobytes(total) * HEADROOM).toFixed(1));
  }

  // A route that is added later and never measured still gets a ceiling.
  budget.defaultBudgetKb = Number((kilobytes(sizes[0]?.[1] ?? 0) * HEADROOM).toFixed(1));

  fs.writeFileSync(BUDGET_FILE, `${JSON.stringify(budget, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), BUDGET_FILE)} from this build.`);
}

function main() {
  const measured = measureRoutes();

  if (process.argv.includes("--update")) {
    updateBudgets(measured);
    return;
  }

  const budgets = loadBudgets();
  if (!budgets) {
    console.error(
      `Missing ${path.relative(process.cwd(), BUDGET_FILE)}. ` +
        "Generate it with `node scripts/check-bundle-size.mjs --update`.",
    );
    process.exit(1);
  }

  const rows = [];
  const failures = [];

  for (const [route, chunks] of [...measured.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let bytes = 0;
    for (const chunk of chunks) bytes += gzipSizeBytes(chunk);

    const budgetKb = budgets.routes?.[route] ?? budgets.defaultBudgetKb;
    const sizeKb = kilobytes(bytes);
    const over = sizeKb > budgetKb;

    rows.push({
      route,
      size: formatKb(bytes),
      budget: `${budgetKb.toFixed(1)} KB`,
      status: over ? "over" : "ok",
    });

    if (over) {
      failures.push(
        `${route} is ${formatKb(bytes)}, over its ${budgetKb.toFixed(1)} KB budget ` +
          `by ${(sizeKb - budgetKb).toFixed(1)} KB`,
      );
    }
  }

  const routeWidth = Math.max(5, ...rows.map((row) => row.route.length));
  console.log(
    `${"Route".padEnd(routeWidth)}  ${"First load".padStart(12)}  ${"Budget".padStart(12)}`,
  );
  console.log("-".repeat(routeWidth + 30));
  for (const row of rows) {
    console.log(
      `${row.route.padEnd(routeWidth)}  ${row.size.padStart(12)}  ${row.budget.padStart(12)}` +
        (row.status === "over" ? "  OVER" : ""),
    );
  }

  if (failures.length > 0) {
    console.error("\nBundle budget exceeded:");
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(
      "\nRun `npm run analyze` to see what a route is made of. If the growth is " +
        "intended, raise that route's budget in bundle-budget.json and explain why.",
    );
    process.exit(1);
  }

  console.log(`\nAll ${rows.length} routes are within budget.`);
}

main();
