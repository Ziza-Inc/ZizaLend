import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  // 🔑 Relative to the folder you run Playwright from (frontend/)
  testDir: "./e2e",

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries, in CI or locally. Retrying a failing spec until it passes is how a real
  // regression gets merged: the second attempt reports green, and the first attempt's red is
  // overwritten before anybody reads it. A spec that cannot pass reliably is quarantined in
  // `docs/QUARANTINED-TESTS.md` with an owner and a deadline, and `npm run check:quarantine`
  // fails CI if one is skipped without a row there.
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  use: {
    baseURL: "http://localhost:3000",
    // `on-first-retry` never fired once retries were set to 0, so the trace artifact — the one
    // thing that made a CI-only failure diagnosable — silently stopped being produced. Keep the
    // artifact, drop the retry.
    trace: "retain-on-failure",
    headless: true, // good for CI
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
