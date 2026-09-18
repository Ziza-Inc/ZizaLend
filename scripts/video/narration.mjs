/**
 * The voice-over.
 *
 * Narration is spoken verbatim from `scenes.mjs` and synthesised locally with `edge-tts`
 * (Microsoft's neural TTS), so the script and the audio cannot drift: changing a claim in
 * `scenes.mjs` changes what is said, on the next narration run.
 *
 * Two properties this module deliberately has:
 *
 *   - **It caches on content, not on time.** Each scene's audio records a hash of the
 *     voice, the rate, and the text. Re-running narration on an unchanged script costs
 *     nothing and touches no files, so the expensive half of the build can sit behind the
 *     cheap half without being skipped by hand.
 *   - **It reports the truth about duration.** Scene length comes from the rendered audio,
 *     measured with ffprobe, not from a word count. A word-count estimate is wrong by tens
 *     of seconds across a four-minute script, which is the difference between the video
 *     fitting its target and the last scene being cut off.
 *
 * The engine is a network call, which is the one thing here that can fail for reasons
 * outside the repository. A failure names the scene and the fix instead of emitting a
 * partial audio directory that `render.mjs` would happily build a silent scene from.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import { SCENES, VIDEO } from "./scenes.mjs";

const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIO = join(HERE, "audio");
const MANIFEST = join(AUDIO, "manifest.json");

/**
 * Voice and delivery.
 *
 * A neural voice at a slightly relaxed rate: the subject matter is dense (contract
 * architecture, coverage gates, error-code registries) and the default rate rushes the
 * figures past the ear. Pitch is left alone — an altered pitch is the fastest way to make
 * a synthetic narrator sound synthetic.
 */
export const VOICE = {
  name: process.env.VIDEO_VOICE ?? "en-US-AndrewNeural",
  rate: process.env.VIDEO_RATE ?? "+2%",
  volume: process.env.VIDEO_VOLUME ?? "+0%",
};

/** Stable identity for a piece of audio: same voice, same rate, same words, same file. */
function fingerprint(text) {
  return createHash("sha256")
    .update(`${VOICE.name}\u0000${VOICE.rate}\u0000${VOICE.volume}\u0000${text}`)
    .digest("hex")
    .slice(0, 16);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Locate a Python interpreter, since the CLI is distributed as a Python package. */
async function python() {
  for (const candidate of ["python3", "python"]) {
    try {
      await run(candidate, ["-c", "import edge_tts"]);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    "edge-tts is not available. Install it with `python3 -m pip install --user edge-tts`, " +
      "or set VIDEO_VOICE and run on a machine that has it. The narration step is the only " +
      "part of this pipeline that needs the network.",
  );
}

/** Duration of a media file in seconds, straight from the decoder. */
export async function durationOf(path) {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    path,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`ffprobe reported no usable duration for ${path}: ${JSON.stringify(stdout)}`);
  }
  return seconds;
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch {
    return { voice: VOICE, scenes: {} };
  }
}

/**
 * Synthesise one scene.
 *
 * The text goes in through a file rather than as a command-line argument: the narration
 * contains apostrophes, quotes, and em dashes, and passing it as an argument is a quoting
 * problem waiting to break on the one line that happens to contain a backtick.
 */
async function synthesise(bin, scene, outPath) {
  const textPath = join(tmpdir(), `zizalend-narration-${scene.id}.txt`);
  await writeFile(textPath, scene.narration, "utf8");
  try {
    await run(
      bin,
      [
        "-m",
        "edge_tts",
        "--voice",
        VOICE.name,
        "--rate",
        VOICE.rate,
        "--volume",
        VOICE.volume,
        "--file",
        textPath,
        "--write-media",
        outPath,
      ],
      { maxBuffer: 32 * 1024 * 1024 },
    );
  } finally {
    await rm(textPath, { force: true }).catch(() => {});
  }
}

/**
 * Build the audio for every scene and return the durations the renderer needs.
 *
 * @param {{ force?: boolean, quiet?: boolean }} options
 * @returns {Promise<Array<{ id: string, file: string, seconds: number, cached: boolean }>>}
 */
export async function narrate({ force = false, quiet = false } = {}) {
  await mkdir(AUDIO, { recursive: true });
  const previous = await readManifest();
  const scenes = [];
  let bin = null;
  let synthesised = 0;

  for (const scene of SCENES) {
    const file = join(AUDIO, `${scene.id}.mp3`);
    const print = fingerprint(scene.narration);
    const cachedEntry = previous.scenes?.[scene.id];
    const reusable =
      !force && cachedEntry?.fingerprint === print && (await exists(file));

    if (!reusable) {
      if (!bin) bin = await python();
      if (!quiet) console.log(`  · synthesising ${scene.id} (${VOICE.name})`);
      try {
        await synthesise(bin, scene, file);
      } catch (error) {
        throw new Error(
          `narration failed for scene ${JSON.stringify(scene.id)}: ${error.message.split("\n")[0]}`,
        );
      }
      synthesised += 1;
    }

    scenes.push({
      id: scene.id,
      file,
      seconds: await durationOf(file),
      fingerprint: print,
      cached: reusable,
    });
  }

  const manifest = {
    voice: VOICE,
    generatedAt: new Date().toISOString(),
    scenes: Object.fromEntries(
      scenes.map((s) => [s.id, { file: `${s.id}.mp3`, seconds: s.seconds, fingerprint: s.fingerprint }]),
    ),
  };
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));

  if (!quiet) {
    const total = scenes.reduce((sum, s) => sum + s.seconds, 0);
    console.log(
      `  narration: ${scenes.length} scenes, ${total.toFixed(1)}s of speech ` +
        `(${synthesised} synthesised, ${scenes.length - synthesised} cached)`,
    );
  }
  return scenes;
}

/**
 * Timeline for the finished video.
 *
 * A scene holds for its narration plus `tail` seconds of silence, so a cross-dissolve
 * always lands on quiet rather than cutting the narrator off mid-word. Transitions overlap
 * consecutive scenes, so the total is the sum of the scene lengths minus one transition
 * per join — arithmetic worth writing down, because getting it wrong means the last scene
 * loses its last second and nobody notices until they watch it.
 */
export function timeline(scenes) {
  const clips = scenes.map((scene) => ({
    ...scene,
    holdSeconds: scene.seconds + VIDEO.tail,
  }));
  const joins = Math.max(0, clips.length - 1);
  const speech = clips.reduce((sum, c) => sum + c.seconds, 0);
  const total = clips.reduce((sum, c) => sum + c.holdSeconds, 0) - joins * VIDEO.transition;
  return {
    clips,
    joins,
    speech,
    total,
    /** Start time of each clip's transition within the finished video. */
    offsets: clips.slice(0, -1).map((_, index) => {
      const consumed = clips
        .slice(0, index + 1)
        .reduce((sum, c) => sum + c.holdSeconds, 0);
      return consumed - (index + 1) * VIDEO.transition;
    }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const scenes = await narrate({ force: process.argv.includes("--force") });
  const { total, speech, joins } = timeline(scenes);
  console.log(
    `\nnarration complete\n` +
      `  speech      ${speech.toFixed(1)}s\n` +
      `  transitions ${joins} x ${VIDEO.transition}s\n` +
      `  video       ${total.toFixed(1)}s (${(total / 60).toFixed(2)} min)\n` +
      `  audio       ${AUDIO}`,
  );
}
