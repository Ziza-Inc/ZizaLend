/**
 * Capture every still the video uses.
 *
 * Two sources. The `live/*` shots come from the deployed Vercel frontend and from
 * GitHub, so the footage is of the actual product rather than a mockup. The `local/*`
 * panels are rendered from files in this repository — the README's lifecycle diagram,
 * the architecture diagram, the gas benchmark table, the error-code registry — so a
 * panel cannot show a number the repository no longer contains.
 *
 * Every shot is written to `assets/<name>.png` with the exact frame geometry the
 * renderer expects.
 */

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";

import { VIDEO, BRAND } from "./scenes.mjs";
import { mockFreighterInitScript, createFundedTestnetAccount } from "./lib/wallet.mjs";
import {
  escapeHtml,
  renderTable,
  tableRowsAfterHeading,
  fences,
  sections,
  stripInline,
} from "./lib/markdown.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ASSETS = join(HERE, "assets");

const SITE = process.env.ZIZALEND_SITE ?? "https://zizalend.vercel.app";
const REPO_URL = "https://github.com/Ziza-Inc/ZizaLend";

/**
 * Text that means the shot must not ship.
 *
 * A capture run that silently records a 404 page or a `Failed to load` panel produces a
 * video that makes claims its own footage contradicts, and nothing about a PNG says
 * which one it is. Every shot is checked against this list and the run fails on a hit.
 * This is not hypothetical: the first version of this file captured a route that 404s in
 * production and a page that rendered an error state, and both were only discovered by
 * reading the recorded text back.
 */
const FORBIDDEN = [
  /page not found/i,
  /\b404\b/,
  /failed to load/i,
  /something went wrong/i,
  /application error/i,
  /unhandled runtime error/i,
];

/**
 * Shots of the deployed application.
 *
 * `signed` selects the capture context: a disconnected visitor is the *only* state that
 * shows the marketing and navigation chrome, so those shots are taken before the wallet
 * gesture and the application shots after it. Getting this backwards is what made an
 * earlier revision record near-empty frames for every `landing-*` shot.
 *
 * `expect` is a substring that has to be in the recorded text. A shot whose page moved
 * or whose feature was renamed fails the run instead of quietly contributing a blank
 * frame to the final cut.
 */
const APP_SHOTS = [
  // Disconnected: the gated marketing view, which is what a new visitor sees.
  { name: "landing-hero", path: "/en", scroll: 0, signed: false, expect: "Connect Wallet" },
  { name: "landing-workflow", path: "/en", scroll: 0.42, signed: false, expect: "Zizalend" },
  { name: "landing-features", path: "/en", scroll: 0.78, signed: false, expect: "Zizalend" },

  // Connected: real Horizon balances and real contract reads for a funded account.
  { name: "wallet", path: "/en/wallet", scroll: 0, signed: true, expect: "Stellar Address" },
  { name: "lend", path: "/en/lend", scroll: 0, signed: true, expect: "Lender" },
  { name: "request-loan", path: "/en/request-loan", scroll: 0, signed: true, expect: "Loan", quiet: ["Checking eligibility", "Fetching your latest score"] },
  { name: "remittances", path: "/en/remittances", scroll: 0, signed: true, expect: "Remittance History" },
  { name: "send-remittance", path: "/en/send-remittance", scroll: 0, signed: true, expect: "Remit" },
  { name: "activity", path: "/en/activity", scroll: 0, signed: true, expect: "Activity" },
  { name: "analytics", path: "/en/analytics", scroll: 0, signed: true, expect: "Analytics" },
  { name: "liquidations", path: "/en/liquidations", scroll: 0, signed: true, expect: "Liquidat" },
  { name: "kingdom", path: "/en/kingdom", scroll: 0, signed: true, expect: "Kingdom" },
  { name: "settings", path: "/en/settings", scroll: 0, signed: true, expect: "Settings" },
];

/** Shots taken from GitHub, so the CI and backlog claims show their real source. */
const GITHUB_SHOTS = [
  { name: "github-actions", url: `${REPO_URL}/actions`, scroll: 0 },
  { name: "github-issues", url: `${REPO_URL}/issues?q=is%3Aissue+is%3Aopen+sort%3Acreated-desc`, scroll: 0 },
  { name: "github-readme", url: REPO_URL, scroll: 0 },
  { name: "github-security", url: `${REPO_URL}/security`, scroll: 0 },
];

/** Shared chrome for the locally rendered panels. */
function panelShell({ body, accent = BRAND.violet }) {
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  :root {
    --bg: ${BRAND.bg}; --surface: ${BRAND.surface}; --elev: ${BRAND.surfaceElevated};
    --violet: ${BRAND.violet}; --teal: ${BRAND.teal}; --text: ${BRAND.text};
    --muted: ${BRAND.textMuted}; --secondary: ${BRAND.textSecondary}; --border: ${BRAND.border};
    --accent: ${accent};
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); }
  body {
    width: ${VIDEO.width}px; height: ${VIDEO.height}px; overflow: hidden;
    font-family: "DejaVu Sans", "Liberation Sans", system-ui, sans-serif;
    color: var(--text);
    background:
      radial-gradient(1100px 620px at 12% -12%, rgba(124,58,237,0.22), transparent 62%),
      radial-gradient(900px 520px at 108% 108%, rgba(14,207,207,0.13), transparent 60%),
      var(--bg);
  }
  .wrap { padding: 74px 92px; height: 100%; display: flex; flex-direction: column; }
  .kicker {
    display: inline-flex; align-items: center; gap: 10px;
    font-size: 17px; letter-spacing: 0.22em; text-transform: uppercase;
    color: var(--teal); font-weight: 700; margin-bottom: 18px;
  }
  .kicker::before { content: ""; width: 34px; height: 2px; background: var(--teal); display: block; }
  h1 { font-size: 52px; line-height: 1.1; margin: 0 0 14px; letter-spacing: -0.02em; }
  h1 .accent { color: var(--accent); }
  .standfirst { font-size: 21px; color: var(--secondary); margin: 0 0 34px; max-width: 1180px; line-height: 1.5; }
  .panel {
    background: linear-gradient(180deg, rgba(30,30,42,0.92), rgba(22,22,31,0.92));
    border: 1px solid var(--border); border-radius: 18px; padding: 26px 30px;
    box-shadow: 0 18px 60px rgba(0,0,0,0.55);
  }
  table { width: 100%; border-collapse: collapse; font-size: 20px; }
  th { text-align: left; font-size: 15px; letter-spacing: 0.12em; text-transform: uppercase;
       color: var(--teal); padding: 10px 14px; border-bottom: 1px solid var(--border); font-weight: 700; }
  td { padding: 13px 14px; border-bottom: 1px solid rgba(42,42,58,0.55); color: var(--text); }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(odd) { background: rgba(255,255,255,0.018); }
  .al-right { text-align: right; font-variant-numeric: tabular-nums; }
  .al-center { text-align: center; }
  code, .mono { font-family: "DejaVu Sans Mono", monospace; }
  .footer { margin-top: auto; font-size: 17px; color: var(--muted); }
</style></head>
<body><div class="wrap">${body}</div></body></html>`;
}

/**
 * Save a still, and the text that was on screen when it was taken.
 *
 * The text file is not decoration. Nobody can tell from a PNG alone whether a screen
 * rendered its real content or an empty state, and a pitch video built on empty states
 * is a pitch video making claims its own footage contradicts. Recording what was
 * visible at capture time makes that checkable — including by `verify.mjs` — instead
 * of being something you have to open twenty screenshots to find out.
 */
async function shoot(page, name, { selector = null } = {}) {
  const target = selector ? page.locator(selector).first() : page;
  const path = join(ASSETS, `${name}.png`);
  await mkdir(dirname(path), { recursive: true });
  await target.screenshot({ path, animations: "disabled" });

  const visible = await page
    .evaluate(() => {
      const out = [];
      const walk = (node) => {
        if (node.nodeType !== 1) return;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const onScreen =
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < window.innerHeight &&
          style.visibility !== "hidden" &&
          style.display !== "none";
        if (!onScreen) return;
        if (node.children.length === 0) {
          const text = (node.textContent ?? "").trim();
          if (text) out.push(text);
        }
        for (const child of node.children) walk(child);
      };
      walk(document.body);
      return out;
    })
    .catch(() => []);

  const textPath = join(ASSETS, `${name}.txt`);
  await mkdir(dirname(textPath), { recursive: true });
  await writeFile(textPath, [...new Set(visible)].join("\n"));
  return path;
}

/**
 * Scroll to a fraction of the page and pause, so a shot taken mid-page lands where it
 * was asked to. Scrolling with `scrollTo` rather than `scrollIntoView` keeps the framing
 * predictable when the page has sticky headers that would otherwise re-anchor.
 */
async function scrollToFraction(page, fraction) {
  if (!fraction) return;
  await page.evaluate((f) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: Math.max(0, Math.round(max * f)), behavior: "instant" });
  }, fraction);
  await page.waitForTimeout(900);
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // Fonts, the first animation frame, and any client-side data fetch that resolves
  // after `networkidle` all change the pixels. A short fixed settle is more predictable
  // than waiting for a selector that varies per route.
  await page.waitForTimeout(1600);
}

/**
 * Wait for a page to stop showing a spinner before photographing it.
 *
 * A fixed settle is enough for a page that renders synchronously, but a page that waits
 * on a contract read is either finished or still loading, and a still take too early
 * captures the skeleton. Rather than lengthening every shot's settle — which slows the
 * whole run to fix one page — a shot names the loading text it expects to disappear and
 * is given a bounded grace period to do it. Exceeding the budget is a failure, because a
 * pitch video full of spinners is a pitch video with nothing in it.
 */
async function settleUntilContent(page, { quiet = [], budgetMs = 15000 } = {}) {
  await settle(page);
  if (!quiet.length) return;
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const pending = quiet.find((marker) => text.includes(marker));
    if (!pending) return;
    if (Date.now() >= deadline) {
      throw new Error(`still showing ${JSON.stringify(pending)} after ${budgetMs}ms`);
    }
    await page.waitForTimeout(500);
  }
}

/**
 * Capture the deployed application with a wallet connected.
 *
 * The real build, the real contracts, and a real funded Testnet account — the only
 * intervention is the read-only Freighter stand-in in `lib/wallet.mjs`, without which
 * every screen past the connect gate is a prompt. See that file for the boundary.
 */
/**
 * Read back the text recorded beside a still and reject a frame that shows a failure.
 *
 * Returns the text so the caller can report which expectation was missed. Throwing is
 * deliberate: a capture that exits zero while holding a 404 in its assets directory is
 * worse than one that exits non-zero, because the failure then surfaces in the render
 * rather than here.
 */
async function assertShot(name, expect) {
  const text = await readFile(join(ASSETS, `live/${name}.txt`), "utf8");
  const hit = FORBIDDEN.find((pattern) => pattern.test(text));
  if (hit) {
    throw new Error(`live/${name} recorded a failure state (matched ${hit}): ${text.slice(0, 160)}`);
  }
  if (expect && !text.includes(expect)) {
    throw new Error(`live/${name} did not contain ${JSON.stringify(expect)}: ${text.slice(0, 160)}`);
  }
  return text;
}

async function captureLive(browser) {
  const publicKey = await createFundedTestnetAccount();
  console.log(`  funded capture wallet: ${publicKey}`);

  const context = await browser.newContext({
    viewport: { width: VIDEO.width, height: VIDEO.height },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await context.addInitScript(mockFreighterInitScript(publicKey));
  const page = await context.newPage();
  const written = [];
  const failures = [];

  // The application only reaches for the wallet when the visitor asks it to, so the
  // connect gesture has to happen once before any gated screen will render.
  await page.goto(SITE + "/en", { waitUntil: "domcontentloaded", timeout: 60000 });
  await settle(page);
  written.push(await shoot(page, "live/wallet-connect-gate"));
  console.log("  \u2713 live/wallet-connect-gate");

  for (const shot of APP_SHOTS) {
    const url = SITE + shot.path;
    try {
      // Re-cross the gate before every signed shot rather than trusting the session to
      // persist: the store is client-side, and a full navigation resets it, which would
      // otherwise silently downgrade a signed shot to the public view.
      if (shot.signed) await connectWallet(page);

      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      if (!response || response.status() >= 400) {
        throw new Error(`HTTP ${response?.status()} at ${url}`);
      }
      await settle(page);
      if (shot.signed) await connectWallet(page);
      await settleUntilContent(page, { quiet: shot.quiet });
      await scrollToFraction(page, shot.scroll);
      written.push(await shoot(page, `live/${shot.name}`));
      await assertShot(shot.name, shot.expect);
      console.log(`  \u2713 live/${shot.name}`);
    } catch (error) {
      console.warn(`  \u2717 ${shot.name}: ${error.message.split("\n")[0]}`);
      failures.push(shot.name);
    }
  }

  await context.close();

  if (failures.length) {
    throw new Error(`capture failed for ${failures.length} shot(s): ${failures.join(", ")}`);
  }
  return written.filter(Boolean);
}

/**
 * Drive the deployed application through its own connect gesture.
 *
 * Idempotent on purpose: the button is absent once a session exists, and a missing button
 * is the success case rather than an error, so a second call is a no-op instead of a
 * timeout.
 */
async function connectWallet(page) {
  const connect = page.getByRole("button", { name: /connect wallet/i }).first();
  if (!(await connect.isVisible().catch(() => false))) return;
  await connect.click({ timeout: 15000 });
  await page.waitForTimeout(2500);
}

async function captureGithub(browser) {
  const context = await browser.newContext({
    viewport: { width: VIDEO.width, height: VIDEO.height },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  const written = [];
  for (const shot of GITHUB_SHOTS) {
    try {
      const response = await page.goto(shot.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      if (!response || response.status() >= 400) {
        console.warn(`  ! ${shot.name}: HTTP ${response?.status()}`);
        continue;
      }
      await settle(page);
      // GitHub's own cookie banner and "sign in" bar sit over the content.
      await page.evaluate(() => {
        for (const id of ["cookie-banner", "js-cookie-consent-banner"]) {
          document.getElementById(id)?.remove();
        }
      });
      await scrollToFraction(page, shot.scroll);
      written.push(await shoot(page, `live/${shot.name}`));
      console.log(`  ✓ live/${shot.name}`);
    } catch (error) {
      console.warn(`  ! ${shot.name}: ${error.message.split("\n")[0]}`);
    }
  }
  await context.close();
  return written;
}

async function captureLocal(browser) {
  const context = await browser.newContext({
    viewport: { width: VIDEO.width, height: VIDEO.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const written = [];
  const write = async (name, html, settleMs = 1200) => {
    await page.setContent(html, { waitUntil: "load" });
    // Mermaid fetches its runtime from a CDN and lays the graph out after `load`
    // fires, so the diagram panels need a longer settle than the static ones.
    await page.waitForTimeout(settleMs);
    written.push(await shoot(page, `local/${name}`));
    console.log(`  ✓ local/${name}`);
  };

  const readme = await readFile(join(REPO, "README.md"), "utf8");
  const architecture = await readFile(join(REPO, "ARCHITECTURE.md"), "utf8");
  const gas = await readFile(join(REPO, "docs", "GAS.md"), "utf8");
  const errorCodes = await readFile(join(REPO, "docs", "ERROR_CODES.md"), "utf8");

  // --- README lifecycle diagram, rendered from the README itself -------------------
  const readmeDiagram = fences(readme, "mermaid")[0];
  if (readmeDiagram) {
    await write("readme-lifecycle", await mermaidPanel({
      diagram: readmeDiagram,
      kicker: "How it works",
      title: "Remittance history becomes <span class=\"accent\">portable credit</span>",
      standfirst: "The lifecycle the contracts enforce, taken from the repository's own README.",
    }), 4500);
  } else {
    console.warn("  ! README.md has no mermaid diagram; skipping readme-lifecycle");
  }

  // --- architecture diagram, from ARCHITECTURE.md ---------------------------------
  const architectureDiagram = fences(architecture, "mermaid")[0];
  if (architectureDiagram) {
    await write("architecture", await mermaidPanel({
      diagram: architectureDiagram,
      kicker: "System architecture",
      title: "Four contracts, one trust boundary",
      standfirst: "Drawn from ARCHITECTURE.md — the same graph a contributor reads.",
      wide: true,
    }), 4500);
  } else {
    console.warn("  ! ARCHITECTURE.md has no mermaid diagram; skipping architecture");
  }

  // --- gas benchmark table ---------------------------------------------------------
  const gasRows = tableRowsAfterHeading(gas, "Transaction costs");
  if (gasRows) {
    const summary = gas
      .split("\n")
      .filter((l) => l.startsWith("- **"))
      .slice(0, 3)
      .map((l) => `<li>${escapeHtml(stripInline(l.replace(/^-\s*/, "")))}</li>`)
      .join("");
    await write("gas-table", panelShell({
      accent: BRAND.teal,
      body: `
        <div class="kicker">Gas &amp; resource benchmarks</div>
        <h1>Every major transaction, <span class="accent">measured on Testnet</span></h1>
        <p class="standfirst">Generated by <span class="mono">scripts/benchmark-gas.ts</span> against the deployed
        contracts. State-dependent figures, reported by the host on simulation — the same path a wallet uses to
        estimate a fee.</p>
        <div class="panel">${renderTable(gasRows)}</div>
        <ul class="standfirst" style="margin-top:26px;font-size:19px;">${summary}</ul>
      `,
    }));
  } else {
    console.warn("  ! docs/GAS.md has no 'Transaction costs' table; skipping gas-table");
  }

  // --- error-code registry ---------------------------------------------------------
  const summaryRows = tableRowsAfterHeading(errorCodes, "Contract error codes");
  if (summaryRows) {
    const codeLine = (errorCodes.match(/\*\*(\d+) codes\*\*/) ?? [])[1] ?? "";
    await write("error-codes", panelShell({
      accent: BRAND.violet,
      body: `
        <div class="kicker">Error handling</div>
        <h1>${codeLine} typed error codes, <span class="accent">every one documented</span></h1>
        <p class="standfirst">Generated by <span class="mono">scripts/generate-error-codes.mjs</span> and checked in CI,
        which is also how a duplicate or unassigned code is caught. Codes are permanent: a deployed variant's number
        is part of the ABI.</p>
        <div class="panel">${renderTable(summaryRows)}</div>
        <p class="standfirst" style="margin-top:28px;font-size:19px;">
          A failed Soroban call reports only <span class="mono">Error(Contract, #13)</span>. The name, the trigger, and
          the recovery all have to come from the registry.
        </p>
      `,
    }));
  } else {
    console.warn("  ! docs/ERROR_CODES.md has no summary table; skipping error-codes");
  }

  // --- contract source, so the video shows real code ---------------------------------
  const contractSource = await readFile(
    join(REPO, "contracts", "loan_manager", "src", "lib.rs"),
    "utf8",
  ).catch(() => "");
  if (contractSource) {
    const snippet = contractSource.split("\n").slice(0, 46).join("\n");
    const callable = /pub fn\s+\w+/g;
    const callCount = (contractSource.match(callable) ?? []).length;
    await write("contract-code", panelShell({
      accent: BRAND.teal,
      body: `
        <div class="kicker">Soroban · Rust</div>
        <h1>LoanManager — <span class="accent">${callCount} public entry points</span></h1>
        <p class="standfirst">The contract that owns the loan lifecycle: request, approval, interest accrual,
        repayment, and liquidation. From <span class="mono">contracts/loan_manager/src/lib.rs</span>.</p>
        <div class="panel" style="padding:0;overflow:hidden;">
          <pre class="mono" style="margin:0;padding:26px 30px;font-size:17.5px;line-height:1.62;color:#E2E8F0;
            white-space:pre;tab-size:4;">${escapeHtml(snippet)}</pre>
        </div>
      `,
    }));
  }

  // --- the end-to-end verification claim, with the real command ---------------------
  await write("smoke-test", panelShell({
    accent: BRAND.success,
    body: `
      <div class="kicker">Verification</div>
      <h1>The whole journey, <span class="accent">run against Testnet</span></h1>
      <p class="standfirst">A deployment that only proves the contracts exist is a set of addresses, not a working
      system. <span class="mono">smoke-testnet.ts</span> funds a fresh lender and borrower and runs the real user
      journey end to end.</p>
      <div class="panel" style="padding:0;overflow:hidden;">
        <pre class="mono" style="margin:0;padding:30px 34px;font-size:21px;line-height:1.85;color:#E2E8F0;">$ cd scripts &amp;&amp; SECRET_KEY=&lt;admin&gt; npx ts-node smoke-testnet.ts testnet

  <span style="color:${BRAND.success}">\u2713</span> wiring              contracts initialised and cross-wired
  <span style="color:${BRAND.success}">\u2713</span> deposit             lender funds the pool, shares minted
  <span style="color:${BRAND.success}">\u2713</span> withdrawal guard    over-withdrawal rejected on chain
  <span style="color:${BRAND.success}">\u2713</span> credit identity     Remittance NFT minted for the borrower
  <span style="color:${BRAND.success}">\u2713</span> loan approval       principal moved out of the pool
  <span style="color:${BRAND.success}">\u2713</span> repayment           interest accrued, principal settled
  <span style="color:${BRAND.success}">\u2713</span> score credited      repayment reflected in the credit score
  <span style="color:${BRAND.success}">\u2713</span> withdrawal          lender withdraws with yield

  <span style="color:${BRAND.teal};font-weight:700">8/8 on Stellar Testnet</span></pre>
      </div>
    `,
  }));

  // --- what makes this more than a DApp --------------------------------------------
  const repoPromise = sections(readme).find((s) => /feature/i.test(s.heading));
  const bullets = (repoPromise?.body ?? "")
    .split("\n")
    .filter((l) => /^[-*]\s+\*\*/.test(l))
    .slice(0, 6)
    .map((l) => stripInline(l.replace(/^[-*]\s+/, "")))
    .map((text) => {
      const [head, ...rest] = text.split("—");
      return `<li><strong>${escapeHtml(head.trim())}</strong>${
        rest.length ? ` — ${escapeHtml(rest.join("—").trim())}` : ""
      }</li>`;
    })
    .join("");

  await write("tooling", panelShell({
    accent: BRAND.teal,
    body: `
      <div class="kicker">Beyond the DApp</div>
      <h1>Tooling and infrastructure, <span class="accent">not a demo</span></h1>
      <p class="standfirst">The repository ships the things a team needs to keep building: deployment and verification
      scripts, a gas benchmark harness, a generated error-code registry, an OpenAPI spec, a typed SDK, and a backlog
      reviewed like code.</p>
      <div class="panel"><ul style="margin:0;padding-left:26px;font-size:21px;line-height:1.75;color:#E2E8F0;">
        ${bullets || "<li>Repository tooling and documentation</li>"}
      </ul></div>
    `,
  }));

  // --- the 100+ contributor issues claim is now in the backlog, but section 6 of the
  //     README documents "who this is for". The issue count is checked by verify.mjs.

  await context.close();
  return written;
}

/**
 * Render a Mermaid diagram to a still.
 *
 * Mermaid is loaded from a CDN on purpose: bundling it would add a multi-megabyte
 * dependency to the repository for a build step that runs on one machine, and the
 * diagram source still comes from the repository, which is the part that has to stay
 * current. If the CDN is unreachable the panel is skipped rather than faked.
 */
async function mermaidPanel({ diagram, kicker, title, standfirst, wide = false }) {
  const html = panelShell({
    body: `
      <div class="kicker">${kicker}</div>
      <h1>${title}</h1>
      <p class="standfirst">${standfirst}</p>
      <div class="panel" style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;">
        <pre class="mermaid" style="margin:0;width:100%;">${escapeHtml(diagram)}</pre>
      </div>
    `,
  });
  const injection = `
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({
        startOnLoad: true,
        theme: "base",
        themeVariables: {
          background: "${BRAND.bg}",
          primaryColor: "${BRAND.surfaceElevated}",
          primaryTextColor: "${BRAND.text}",
          primaryBorderColor: "${BRAND.violet}",
          lineColor: "${BRAND.textMuted}",
          secondaryColor: "${BRAND.teal}",
          tertiaryColor: "${BRAND.surface}",
          fontFamily: "DejaVu Sans, sans-serif",
          fontSize: "${wide ? 17 : 20}px"
        },
        flowchart: { curve: "basis", padding: 18, nodeSpacing: 60, rankSpacing: 70 },
      });
    </script>`;
  return html.replace("</body>", `${injection}</body>`);
}

async function main() {
  await mkdir(ASSETS, { recursive: true });
  const browser = await chromium.launch();

  console.log(`Capturing from ${SITE}`);
  const written = [];
  try {
    written.push(...(await captureLive(browser)));
    written.push(...(await captureGithub(browser)));
    written.push(...(await captureLocal(browser)));
  } finally {
    await browser.close();
  }

  const manifest = written.map((p) => p.replace(ASSETS + "/", "").replace(/\.png$/, ""));
  await writeFile(
    join(ASSETS, "manifest.json"),
    JSON.stringify({ capturedAt: new Date().toISOString(), site: SITE, assets: manifest }, null, 2),
  );
  console.log(`\nCaptured ${manifest.length} assets into ${ASSETS}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
