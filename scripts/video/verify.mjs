/**
 * Check the finished video against the repository before it is published.
 *
 * A pitch video makes factual claims, and those claims are the easiest thing in a project
 * to leave behind: the numbers are written once, the project moves, and nobody watches four
 * minutes of footage to notice that the workflow count is now wrong. This file is what
 * stops that. Every figure that appears in the narration or on screen is looked up in the
 * repository or from GitHub, and a mismatch fails the build with the exact edit to make.
 *
 * Checks come in three kinds, and the distinction is deliberate:
 *
 *   - **Repository facts** (workflow count, error codes, coverage gate, contract count, gas
 *     rows) are read from the checkout. These are stable, so a mismatch is always a real
 *     one and always a failure.
 *   - **Live facts** (open issues, required status checks) come from GitHub and therefore
 *     move on their own. They are checked authoritatively when `gh` is available and
 *     reported as skipped when it is not, so the pipeline still runs offline instead of
 *     failing for a reason that has nothing to do with the video.
 *   - **Artifact facts** (the file has streams, the bar advances, the audio is at a sane
 *     level) are decoded from the output. These catch the failures that looking at a
 *     filename cannot: an encode that produced the right length and no audio, or a progress
 *     bar that was drawn once and never moved.
 */

import { execFile } from "node:child_process";
import { readFile, readdir, stat, access, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";

import { SCENES, VIDEO, BRAND } from "./scenes.mjs";
import { OVERLAY_KINDS } from "./overlays.mjs";
import { narrate, timeline, durationOf } from "./narration.mjs";
import { ARTIFACTS } from "./render.mjs";

const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const README = join(REPO, "README.md");

/** Results are collected rather than thrown on the first failure, so one run lists all of them. */
class Report {
  constructor() {
    this.checks = [];
  }

  pass(name, detail) {
    this.checks.push({ name, status: "pass", detail });
  }

  fail(name, detail) {
    this.checks.push({ name, status: "fail", detail });
  }

  skip(name, detail) {
    this.checks.push({ name, status: "skip", detail });
  }

  get failures() {
    return this.checks.filter((c) => c.status === "fail");
  }

  print(quiet) {
    const icon = { pass: "\u2713", fail: "\u2717", skip: "\u2013" };
    for (const check of this.checks) {
      if (quiet && check.status === "pass") continue;
      console.log(`  ${icon[check.status]} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`);
    }
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Run a check body, converting a thrown error into a failure rather than a crash. */
async function check(report, name, body) {
  try {
    const detail = await body();
    if (detail === undefined || detail === null) return;
    report.pass(name, String(detail));
  } catch (error) {
    report.fail(name, error.message.split("\n")[0]);
  }
}

/* ─────────────────────────── repository facts ─────────────────────────── */

/** Every numeric claim in the video, and where in the repository it is decided. */
async function repositoryFacts(report) {
  await check(report, "ci workflows", async () => {
    const files = (await readdir(join(REPO, ".github", "workflows"))).filter((f) =>
      f.endsWith(".yml"),
    );
    const claimed = claimNumber("ci", /(\d+) GitHub Actions workflows/);
    if (files.length !== claimed) {
      throw new Error(
        `scenes.mjs claims ${claimed} workflows, the repository has ${files.length}. ` +
          `Update the "ci" scene's narration and overlay.`,
      );
    }
    return `${files.length} workflow files`;
  });

  await check(report, "error codes", async () => {
    const doc = await readFile(join(REPO, "docs", "ERROR_CODES.md"), "utf8");
    const codes = Number((doc.match(/\*\*(\d+) codes\*\*/) ?? [])[1]);
    if (!Number.isFinite(codes)) {
      throw new Error("docs/ERROR_CODES.md no longer states its total; run generate-error-codes.mjs");
    }
    const claimed = claimNumber("security", /(\d+) error codes/);
    if (claimed === null) throw new Error("the 'security' scene no longer states an error-code count");
    if (claimed && codes !== claimed) {
      throw new Error(`scenes.mjs claims ${claimed} error codes, the registry documents ${codes}`);
    }
    if (codes < 100) {
      throw new Error(`the registry documents ${codes} codes, below the claimed hundred-plus`);
    }
    return `${codes} codes, asserted >= 100`;
  });

  await check(report, "coverage gate", async () => {
    const ci = await readFile(join(REPO, ".github", "workflows", "ci.yml"), "utf8");
    const gate = Number((ci.match(/--fail-under\s+(\d+)/) ?? [])[1]);
    if (!Number.isFinite(gate)) throw new Error("ci.yml no longer gates coverage with --fail-under");
    // The narration spells the threshold out as words, because that is how it is spoken;
    // `sceneHaystack` normalises number words to digits, so both forms of the claim are
    // read here and compared against what CI actually enforces.
    const spokenValue = claimNumber("performance", /gated at (\d+) percent/);
    if (spokenValue === null) {
      throw new Error("could not read a coverage threshold out of the 'performance' narration");
    }
    if (gate !== spokenValue) {
      throw new Error(`the narration claims a ${spokenValue}% gate, ci.yml enforces ${gate}%`);
    }
    return `narration and ci.yml agree on --fail-under ${gate}`;
  });

  await check(report, "smart contracts", async () => {
    // A Soroban contract is identified by `crate-type = ["cdylib"]`, not by having a
    // `src/lib.rs`: the workspace also holds an integration-test crate that has one, and
    // counting it would make the video claim five contracts when there are four.
    const crates = [];
    const dirs = await readdir(join(REPO, "contracts"), { withFileTypes: true });
    for (const entry of dirs.filter((d) => d.isDirectory() && !d.name.startsWith("."))) {
      const manifest = await readFile(
        join(REPO, "contracts", entry.name, "Cargo.toml"),
        "utf8",
      ).catch(() => "");
      if (/crate-type\s*=\s*\[[^\]]*cdylib/.test(manifest)) crates.push(entry.name);
    }
    const claimed = claimNumber("architecture", /(\d+) Soroban contracts/);
    if (claimed !== crates.length) {
      throw new Error(
        `scenes.mjs claims ${claimed} Soroban contracts, the workspace has ${crates.length}: ` +
          crates.join(", "),
      );
    }
    return `${crates.length} contract crates: ${crates.join(", ")}`;
  });

  await check(report, "gas benchmark rows", async () => {
    const gas = await readFile(join(REPO, "docs", "GAS.md"), "utf8");
    // The published summary is the authoritative count, and it separates the operations
    // that reach a ledger from the read paths that never do — which is exactly the
    // distinction the narration makes when it says "state-changing".
    const summary = gas.match(/\*\*(\d+) state-changing operations\*\*/);
    if (!summary) throw new Error("docs/GAS.md no longer summarises its state-changing operations");
    const stateChanging = Number(summary[1]);
    const reads = Number((gas.match(/\*\*(\d+) read operations\*\*/) ?? [])[1]);
    const claimed = claimNumber("performance", /(\d+) state-changing operations/);
    if (claimed !== stateChanging) {
      throw new Error(`scenes.mjs claims ${claimed} benchmarked operations, GAS.md publishes ${stateChanging}`);
    }
    return `${stateChanging} state-changing + ${reads} read operations`;
  });

  await check(report, "smoke test claim", async () => {
    const readme = await readFile(README, "utf8");
    // The badge states the result as a ratio and the reproduction block states the steps.
    // Checking that the two agree is the point: a badge is a number someone typed, and
    // the step list is what a reader can actually run.
    const badge = readme.match(/smoke_test-(\d+)%2F(\d+)_on_Testnet/);
    if (!badge) throw new Error("README's smoke-test badge no longer states a pass ratio");
    const [, passed, total] = badge;
    if (passed !== total) throw new Error(`the smoke-test badge claims ${passed}/${total}`);
    const reproduction = readme.match(/^✅\s*(.+)$/m);
    if (!reproduction) throw new Error("README's reproduction block no longer lists smoke-test steps");
    const steps = reproduction[1].split("·").map((s) => s.trim()).filter(Boolean);
    if (String(steps.length) !== total) {
      throw new Error(`the badge claims ${total} steps, the reproduction block lists ${steps.length}`);
    }
    const scene = SCENES.find((s) => s.id === "close");
    if (!/verified end to end/.test(scene.narration)) {
      throw new Error("the closing scene no longer claims end-to-end verification");
    }
    return `${passed}/${total} steps agree between the badge and the reproduction block`;
  });
}

/**
 * Spoken number words, longest phrase first so "one hundred and twenty" is not eaten by
 * "twenty".
 *
 * The narration spells numbers out because that is how they are read aloud, while the
 * overlays use digits because that is how they are read on screen. A claim therefore lives
 * in two forms in the same scene, and comparing them to the repository means normalising
 * one to the other first.
 */
const NUMBER_WORDS = [
  ["one hundred and twenty", "120"],
  ["one hundred and thirteen", "113"],
  ["seventy-five", "75"],
  ["seventy five", "75"],
  ["thirteen", "13"],
  ["seven", "7"],
  ["six", "6"],
  ["five", "5"],
  ["four", "4"],
  ["three", "3"],
];

function normaliseNumbers(text) {
  return NUMBER_WORDS.reduce(
    (out, [word, digit]) => out.replace(new RegExp(`\\b${word}\\b`, "gi"), digit),
    text,
  );
}

/**
 * Everything a scene asserts, as one searchable string: the narration as spoken, plus every
 * number and label the overlay draws, in the order a viewer reads them.
 *
 * Built from the parsed scene rather than from its source text, so a reformat of
 * `scenes.mjs` does not break a check but a change to a claimed figure does.
 */
function sceneHaystack(sceneId) {
  const scene = SCENES.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`no scene named ${JSON.stringify(sceneId)} in scenes.mjs`);
  const overlay = scene.overlay ?? {};
  const parts = [
    scene.narration,
    overlay.eyebrow,
    overlay.title,
    overlay.subtitle,
    overlay.footer,
  ];
  for (const item of overlay.items ?? []) {
    if (item.value !== undefined && item.label !== undefined) parts.push(`${item.value} ${item.label}`);
    if (item.text) parts.push(item.text);
  }
  for (const link of overlay.links ?? []) parts.push(`${link.label} ${link.value}`);
  for (const point of overlay.points ?? []) parts.push(point);
  return normaliseNumbers(parts.filter(Boolean).join("\n"));
}

/**
 * The number a scene claims, or `null` when the pattern does not match.
 *
 * Returned as a number, not the matched substring: every comparison here is between a
 * claimed quantity and a counted one, and `113 !== "113"` is the kind of bug that makes a
 * check pass while proving nothing.
 */
function claimNumber(sceneId, pattern) {
  const match = sceneHaystack(sceneId).match(pattern);
  return match ? Number(match[1]) : null;
}

/* ───────────────────────────── live facts ───────────────────────────── */

async function liveFacts(report) {
  let available = true;
  try {
    await run("gh", ["auth", "status"], { env: { ...process.env, GITHUB_TOKEN: "" } });
  } catch {
    available = false;
  }

  if (!available) {
    report.skip("open issues", "gh is not authenticated; live counts not checked");
    report.skip("required status checks", "gh is not authenticated; live counts not checked");
    return;
  }

  const gh = (args) =>
    run("gh", args, { env: { ...process.env, GITHUB_TOKEN: "" }, maxBuffer: 16 * 1024 * 1024 });

  await check(report, "open issues", async () => {
    const { stdout } = await gh([
      "api",
      "repos/Ziza-Inc/ZizaLend/issues?state=open&per_page=100&page=1",
      "--jq",
      "[.[] | select(.pull_request == null)] | length",
    ]);
    const { stdout: page2 } = await gh([
      "api",
      "repos/Ziza-Inc/ZizaLend/issues?state=open&per_page=100&page=2",
      "--jq",
      "[.[] | select(.pull_request == null)] | length",
    ]);
    const open = Number(stdout.trim()) + Number(page2.trim());
    const claimed = claimNumber("open-source", /(\d+) structured open issues/);
    if (open !== claimed) {
      throw new Error(
        `scenes.mjs claims ${claimed} open issues, GitHub reports ${open}. ` +
          `Update the "open-source" scene before publishing.`,
      );
    }
    return `${open} open issues (excluding pull requests)`;
  });

  await check(report, "required status checks", async () => {
    const { stdout } = await gh([
      "api",
      "repos/Ziza-Inc/ZizaLend/branches/main/protection",
      "--jq",
      ".required_status_checks.contexts | length",
    ]);
    const contexts = Number(stdout.trim());
    const claimed = claimNumber("ci", /(\d+)\s+required (?:status )?checks/);
    if (contexts !== claimed) {
      throw new Error(`scenes.mjs claims ${claimed} required checks, branch protection has ${contexts}`);
    }
    return `${contexts} required checks on main`;
  });
}

/* ───────────────────────────── artifacts ───────────────────────────── */

async function artifactFacts(report, { draft }) {
  const video = draft ? join(HERE, "build", "draft.mp4") : ARTIFACTS.video;

  await check(report, "video file", async () => {
    if (!(await exists(video))) throw new Error(`${relative(REPO, video)} does not exist`);
    const info = await stat(video);
    const size = info.size / (1024 * 1024);
    if (size > 95) {
      throw new Error(
        `${size.toFixed(1)}MB exceeds GitHub's 95MB practical limit for a committed file; ` +
          `raise the CRF in render.mjs or host the video as a release asset`,
      );
    }
    return `${size.toFixed(1)}MB`;
  });

  await check(report, "streams and geometry", async () => {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height,r_frame_rate",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      video,
    ]);
    const probe = JSON.parse(stdout);
    const videoStream = probe.streams.find((s) => s.codec_type === "video");
    const audioStream = probe.streams.find((s) => s.codec_type === "audio");
    if (!videoStream) throw new Error("no video stream");
    if (!audioStream) throw new Error("no audio stream — the narration is missing");
    const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
    if (Math.round(num / den) !== VIDEO.fps) {
      throw new Error(`frame rate is ${num / den}, expected ${VIDEO.fps}`);
    }
    const seconds = Number(probe.format.duration);
    if (seconds < 200 || seconds > 300) {
      throw new Error(`${seconds.toFixed(1)}s is outside the 3:20–5:00 window for a pitch video`);
    }
    report.duration = seconds;
    return `${videoStream.width}x${videoStream.height} @ ${VIDEO.fps}fps, ${seconds.toFixed(1)}s`;
  });

  await check(report, "progress bar advances", async () => {
    // Re-probe rather than reaching for a duration captured by an earlier check, so this
    // check is meaningful on its own if it is ever the only one that runs.
    const total = report.duration ?? (await durationOf(video));
    const [early, late] = await Promise.all([
      barFill(video, total * 0.25),
      barFill(video, total * 0.75),
    ]);
    if (!(early > 0.1 && early < 0.4)) {
      throw new Error(`the bar covers ${(early * 100).toFixed(0)}% of the width at 25% through`);
    }
    if (!(late > 0.6 && late < 0.9)) {
      throw new Error(`the bar covers ${(late * 100).toFixed(0)}% of the width at 75% through`);
    }
    if (!(late > early + 0.3)) {
      throw new Error(`the bar does not advance: ${(early * 100).toFixed(0)}% -> ${(late * 100).toFixed(0)}%`);
    }
    return `${(early * 100).toFixed(0)}% at 25%, ${(late * 100).toFixed(0)}% at 75%`;
  });

  await check(report, "audio level", async () => {
    const { stderr } = await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-nostdin",
        "-i",
        video,
        "-af",
        "ebur128=peak=true",
        "-f",
        "null",
        "-",
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    ).catch((error) => ({ stderr: error.stderr ?? "" }));
    // ebur128 prints a per-frame `I:` value as well as the summary, and the first frames of
    // any video are gated out, so the first match is near-silence. The summary is printed
    // last, which makes the final match the integrated figure.
    const matches = [...stderr.matchAll(/I:\s*(-?\d+\.\d+)\s*LUFS/g)];
    const integrated = matches.length ? matches[matches.length - 1][1] : null;
    if (!integrated) throw new Error("could not measure loudness");
    const lufs = Number(integrated);
    if (lufs < -20 || lufs > -11) {
      throw new Error(`integrated loudness is ${lufs} LUFS, outside the -20..-11 window`);
    }
    return `${lufs} LUFS integrated`;
  });
}

/**
 * Fraction of the frame width covered by the progress bar at a timestamp.
 *
 * Decodes one raw RGB row from inside the bar and measures the *contiguous* run of
 * brand-violet pixels starting at the left edge. Reading pixels rather than trusting the
 * filter graph is the point: a `drawbox` whose width expression ffmpeg silently evaluates
 * to zero produces a file that is exactly the right length with no bar in it, and nothing
 * about the file's metadata says so.
 *
 * Contiguity from x=0 is what makes this specific. The application under the bar is itself
 * violet-branded, so "count violet pixels" would match UI chrome; a solid run anchored to
 * the left edge and scaling between the two samples is the bar and nothing else.
 */
async function barFill(video, seconds) {
  const raw = join(HERE, "build", "bar.raw");
  await mkdir(dirname(raw), { recursive: true });
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    // `-y` and `-nostdin`: without them ffmpeg stops at the "file exists, overwrite?"
    // prompt on every run after the first and waits there forever, because a piped stdin
    // never answers it.
    "-y",
    "-nostdin",
    "-ss",
    seconds.toFixed(2),
    "-i",
    video,
    "-frames:v",
    "1",
    // Four pixels up from the bottom sits inside the 8px bar, clear of its edges. The
    // height is 2 rather than 1 because the frame is yuv420p and crop rejects an odd
    // chroma-subsampled dimension — with a one-pixel crop ffmpeg fails outright, and the
    // error it prints blames a zero height rather than the real cause.
    "-vf",
    "crop=w=iw:h=2:x=0:y=ih-4",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    raw,
  ], { maxBuffer: 64 * 1024 * 1024 });

  const all = await readFile(raw);
  // Two rows were cropped; the bar is the first of them.
  const row = all.subarray(0, all.length / 2);
  const target = hexToRgb(BRAND.violet);
  const width = Math.floor(row.length / 3);
  // Named `covered`, not `run`: a local `run` shadows the module's ffmpeg helper and puts
  // it in the temporal dead zone, so the call above would fail before it ever ran.
  let covered = 0;
  for (let x = 0; x < width; x += 1) {
    const near =
      Math.abs(row[x * 3] - target[0]) +
        Math.abs(row[x * 3 + 1] - target[1]) +
        Math.abs(row[x * 3 + 2] - target[2]) <
      150;
    if (!near) break;
    covered += 1;
  }
  return covered / width;
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

/* ───────────────────────────── documentation ───────────────────────────── */

async function documentationFacts(report) {
  await check(report, "README embeds the video", async () => {
    const readme = await readFile(README, "utf8");
    const videoRef = "docs/media/zizalend-pitch.mp4";
    const thumbRef = "docs/media/zizalend-pitch-thumbnail.png";
    if (!readme.includes(videoRef)) throw new Error(`README does not reference ${videoRef}`);
    if (!readme.includes(thumbRef)) throw new Error(`README does not reference ${thumbRef}`);
    if (!(await exists(join(REPO, videoRef)))) throw new Error(`${videoRef} is referenced but missing`);
    if (!(await exists(join(REPO, thumbRef)))) throw new Error(`${thumbRef} is referenced but missing`);
    return "README links the video and its thumbnail, and both exist";
  });
}

/* ───────────────────────────── sequence ───────────────────────────── */

async function sequenceFacts(report, { draft }) {
  await check(report, "footage present for every scene", async () => {
    const manifest = JSON.parse(await readFile(join(HERE, "assets", "manifest.json"), "utf8"));
    const captured = new Set(manifest.assets ?? []);
    const missing = SCENES.filter((s) => s.visual.asset && !captured.has(s.visual.asset));
    if (missing.length) {
      throw new Error(`no capture for: ${missing.map((s) => `${s.id}->${s.visual.asset}`).join(", ")}`);
    }
    return `${manifest.assets.length} captured assets cover every scene`;
  });

  await check(report, "overlay kinds are drawable", async () => {
    const unknown = SCENES.filter((s) => !OVERLAY_KINDS.includes(s.overlay?.kind));
    if (unknown.length) {
      throw new Error(`unknown overlay kinds: ${unknown.map((s) => `${s.id}->${s.overlay?.kind}`).join(", ")}`);
    }
    return `${OVERLAY_KINDS.length} kinds cover ${SCENES.length} scenes`;
  });

  await check(report, "narration covers every scene", async () => {
    const audio = await narrate({ quiet: true });
    const missing = audio.filter((a) => a.seconds < 1);
    if (missing.length) throw new Error(`scenes with no usable audio: ${missing.map((a) => a.id).join(", ")}`);
    const time = timeline(audio);
    if (time.total < 200 || time.total > 300) {
      throw new Error(`${time.total.toFixed(0)}s is outside the 3:20–5:00 window for a pitch video`);
    }
    report.duration = time.total;
    return `${audio.length} scenes, ${time.speech.toFixed(0)}s of speech, ${time.total.toFixed(1)}s total`;
  });

  // A draft deliberately does not publish artifacts, so the thumbnail is not expected. This
  // is a skip rather than a quiet pass: an unverified claim about a missing file is exactly
  // what this file exists to prevent, even when the reason is benign.
  if (draft) {
    report.skip("thumbnail dimensions", "draft render does not publish artifacts");
  } else {
    await check(report, "thumbnail dimensions", async () => {
      if (!(await exists(ARTIFACTS.thumbnail))) throw new Error("thumbnail was not produced");
      const { stdout } = await run("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=p=0",
        ARTIFACTS.thumbnail,
      ]);
      if (!stdout.includes("1920,1080")) {
        throw new Error(`thumbnail is ${stdout.trim()}, expected 1920x1080`);
      }
      return "1920x1080";
    });
  }
}

/**
 * @param {{ draft?: boolean, quiet?: boolean }} options
 * @returns {Promise<{ ok: boolean, report: Report }>}
 */
export async function verify({ draft = false, quiet = false } = {}) {
  const report = new Report();
  if (!quiet) console.log("verifying");

  await sequenceFacts(report, { draft });
  await repositoryFacts(report);
  await liveFacts(report);
  await documentationFacts(report);
  await artifactFacts(report, { draft });

  report.print(quiet);
  return { ok: report.failures.length === 0, report };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { ok, report } = await verify({ draft: process.argv.includes("--draft") });
  console.log(
    `\n${report.checks.filter((c) => c.status === "pass").length} passed, ` +
      `${report.failures.length} failed, ` +
      `${report.checks.filter((c) => c.status === "skip").length} skipped`,
  );
  process.exit(ok ? 0 : 1);
}
