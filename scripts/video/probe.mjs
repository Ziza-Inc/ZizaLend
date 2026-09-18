import { chromium } from "playwright";

const BASE = "https://zizalend.vercel.app";
const ROUTES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["/en", "/en/lend", "/en/loans", "/en/request-loan", "/en/analytics", "/en/activity", "/en/kingdom"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
for (const r of ROUTES) {
  await page.goto(BASE + r, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2500);
  const text = (await page.locator("body").innerText()).replace(/\n{2,}/g, "\n").trim();
  console.log(`\n########## ${r} ##########\n${text.slice(0, 1400)}\n`);
}
await browser.close();
