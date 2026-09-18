/**
 * The one command that produces the pitch video.
 *
 * Order matters, and the order is the argument for having this file at all:
 *
 *   capture (optional) -> render -> verify
 *
 * Verification runs last because it is the only step that can say whether the result is
 * publishable, and a check that runs before the thing it checks is a check nobody reads.
 *
 * Capture is opt-in rather than automatic. Its footage is committed, so an ordinary build
 * uses what is in the repository; re-capturing replaces every still with a fresh timestamp,
 * which invalidates every cached clip and turns a two-minute rebuild into a twenty-minute
 * one. `--capture` is how you say you meant that.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { ARTIFACTS, render } from "./render.mjs";
import { verify } from "./verify.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

/** Run a sibling script as its own process, so a crash in one is not swallowed by another. */
function step(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, script), ...args], {
      cwd: HERE,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${script} exited with ${signal ?? code}`));
    });
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const capture = argv.includes("--capture");
  const draft = argv.includes("--draft");
  const force = argv.includes("--force");
  const started = Date.now();

  if (capture) {
    console.log("capture");
    await step("capture.mjs");
  }

  console.log("render");
  const result = await render({ draft, force });

  console.log("verify");
  const { ok, report } = await verify({ draft });

  const passed = report.checks.filter((c) => c.status === "pass").length;
  const skipped = report.checks.filter((c) => c.status === "skip").length;
  console.log(
    `\n${draft ? "draft" : "final"} build in ${((Date.now() - started) / 1000).toFixed(0)}s\n` +
      `  video      ${relative(REPO, result.file)}\n` +
      (draft ? "" : `  thumbnail  ${relative(REPO, ARTIFACTS.thumbnail)}\n`) +
      `  duration   ${result.total.toFixed(1)}s\n` +
      `  checks     ${passed} passed, ${report.failures.length} failed, ${skipped} skipped`,
  );

  if (!ok) {
    console.error(
      `\nrefusing to publish: ${report.failures.length} claim(s) do not match the repository`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
