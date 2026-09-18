import { chromium } from "playwright";
import { mockFreighterInitScript, createFundedTestnetAccount } from "./lib/wallet.mjs";

const pk = await createFundedTestnetAccount();
console.log("funded wallet:", pk);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
await ctx.addInitScript(mockFreighterInitScript(pk));
const page = await ctx.newPage();
await page.goto("https://zizalend.vercel.app/en", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2500);

const buttons = await page.locator("button, a").allInnerTexts();
console.log("## controls:", JSON.stringify(buttons.filter((b) => /connect|wallet|freighter/i.test(b))));

// Step 1: open the connect modal.
const header = page.getByRole("button", { name: /connect wallet/i }).first();
await header.click().catch((e) => console.log("header click failed", e.message));
await page.waitForTimeout(2000);
console.log("\n## after opening modal:\n", (await page.locator("body").innerText()).slice(0, 900));

const modalButtons = await page.locator("button, a").allInnerTexts();
console.log("\n## modal controls:", JSON.stringify(modalButtons.filter((b) => /connect|freighter|albedo|install/i.test(b))));
await page.screenshot({ path: "assets/_wallettest-modal.png" });

await browser.close();
