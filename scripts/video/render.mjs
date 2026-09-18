/**
 * Turn the captured stills and the narration into the finished video.
 *
 * The composition is deliberately simple, because simple is what survives being re-run:
 *
 *     a still (or a generated gradient)
 *       + a Ken Burns move, so a static screenshot reads as footage
 *       + the scene's overlay, fading in and rising into place
 *       + the scene's narration, held on silence so the dissolve lands on quiet
 *     -> one clip per scene
 *     -> the clips cross-dissolve into each other
 *     -> a finishing pass adds the progress bar, the watermark, and the audio bed
 *
 * Two things about this file are deliberate and worth keeping:
 *
 *   - **Clips are cached on their inputs.** A scene's clip is rebuilt only when the scene,
 *     its footage, its narration, or the encode settings change. A full 1080p render is
 *     minutes of CPU; re-running the pipeline to change one overlay should not pay for
 *     that again, and a build step nobody wants to re-run is a build step that stops
 *     being run.
 *   - **ffmpeg is invoked with an argument array, never a shell string.** The filter graphs
 *     contain quotes, colons, and commas; going through a shell is how a filter graph
 *     acquires a quoting bug that only shows up on a scene with an apostrophe in it.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";

import { chromium } from "playwright";

import { SCENES, VIDEO, BRAND } from "./scenes.mjs";
import { overlayDocument, MOTION } from "./overlays.mjs";
import { narrate, timeline } from "./narration.mjs";

const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ASSETS = join(HERE, "assets");
const BUILD = join(HERE, "build");
const OUT = join(REPO, "docs", "media");

/** Publication paths. The README links these, so they are part of the repository's API. */
export const ARTIFACTS = {
  video: join(OUT, "zizalend-pitch.mp4"),
  thumbnail: join(OUT, "zizalend-pitch-thumbnail.png"),
};

const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
];

/**
 * Encode settings, in one place.
 *
 * `draft` exists so the pipeline can be exercised end to end without paying for a full
 * 1080p build. It changes the size and the rate control and nothing else, so a draft that
 * composes correctly is evidence the real render will compose correctly.
 *
 * Scene clips are encoded near-losslessly and the *finished* video is encoded once. Scene
 * clips are intermediates that get decoded again during composition, and re-encoding them
 * at delivery quality would spend quality twice for a file nobody ever watches.
 */
const QUALITY = {
  // `fast` rather than `slow`/`medium`: the delivery pass is a single generation over
  // screen content at a low CRF, where the slower presets buy a few percent of size and
  // cost minutes of CPU on every rebuild. The rate control is doing the quality work here.
  final: { width: 1920, height: 1080, scale: 2160, crf: "22", preset: "veryfast" },
  draft: { width: 1280, height: 720, scale: 1920, crf: "28", preset: "veryfast" },
};

/**
 * Intermediates: encoded fast, and near-losslessly, so that the delivery encode is the
 * only place quality is spent.
 *
 * `scale` in QUALITY is the headroom the Ken Burns move samples from, and it is the single
 * biggest cost in the build — the move runs at that resolution for every frame of every
 * scene. 1.125x is enough to avoid the move aliasing on a 1920-wide source while costing
 * roughly a quarter of what 1.5x does. `ultrafast` also decodes faster in the composition
 * pass, which is where the intermediates are read back.
 */
const CLIP_QUALITY = {
  final: { crf: "16", preset: "ultrafast" },
  draft: { crf: "26", preset: "ultrafast" },
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fontFile() {
  for (const candidate of FONT_CANDIDATES) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

/** Run ffmpeg and surface its own error text, which is the only useful diagnostic. */
async function ffmpeg(args, { quiet = true } = {}) {
  try {
    // `-nostdin` so a prompt can never be hit: every one of these calls writes to a file
    // that already exists on re-runs, and an unanswered overwrite prompt hangs the build.
    if (process.env.VIDEO_DEBUG) console.error("ffmpeg", args.join(" "));
    const { stderr } = await run(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    if (stderr?.trim() && !quiet) console.warn(stderr.trim());
  } catch (error) {
    const all = (error.stderr ?? error.message ?? "").toString().trim();
    // The last few lines are the useful part, unless the whole thing is being debugged.
    const detail = process.env.VIDEO_DEBUG ? all : all.split("\n").slice(-6).join("\n");
    throw new Error(`ffmpeg failed: ${detail}`);
  }
}

/* ────────────────────────────── overlays ────────────────────────────── */

/**
 * Screenshot every scene's overlay to a transparent PNG.
 *
 * `omitBackground` is what makes these usable as a layer rather than a matte — without it
 * every overlay would be an opaque black rectangle over the footage.
 */
async function renderOverlays(scenes, { quiet }) {
  const dir = join(BUILD, "overlays");
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: VIDEO.width, height: VIDEO.height },
    deviceScaleFactor: 1,
  });

  const written = [];
  try {
    for (const scene of scenes) {
      await page.setContent(overlayDocument(scene), { waitUntil: "load" });
      // Web fonts are not used, but layout still settles a frame late.
      await page.waitForTimeout(120);
      const path = join(dir, `${scene.id}.png`);
      await page.screenshot({ path, omitBackground: true });
      written.push({ id: scene.id, path });
      if (!quiet) console.log(`  · overlay ${scene.id}`);
    }
  } finally {
    await browser.close();
  }
  return written;
}

/* ────────────────────────────── clips ────────────────────────────── */

/**
 * Ken Burns parameters for a scene's move.
 *
 * Expressed in terms of `on / frames` — the fraction of the move completed — rather than
 * ffmpeg's stateful `zoom`, so the same scene renders identically whether it is built on
 * its own or as part of a longer run. `zoompan` is fed a single input frame (see below),
 * so `on` counts that frame's output frames.
 */
function motionExpr(motion, frames) {
  const progress = `on/${frames}`;
  const centredX = "iw/2-(iw/zoom/2)";
  const centredY = "ih/2-(ih/zoom/2)";
  switch (motion) {
    case "zoom-out":
      return { z: `1.14-0.14*${progress}`, x: centredX, y: centredY };
    case "pan-right":
      return { z: "1.12", x: `(iw-iw/zoom)*${progress}`, y: centredY };
    case "pan-left":
      return { z: "1.12", x: `(iw-iw/zoom)*(1-${progress})`, y: centredY };
    case "pan-down":
      return { z: "1.12", x: centredX, y: `(ih-ih/zoom)*${progress}` };
    case "pan-up":
      return { z: "1.12", x: centredX, y: `(ih-ih/zoom)*(1-${progress})` };
    case "zoom-in":
    default:
      return { z: `1+0.14*${progress}`, x: centredX, y: centredY };
  }
}

/** A generated background for scenes that have no footage, so the frame is never flat. */
function gradientInput(scene, hold) {
  const [c0, c1] = scene.visual.gradient ?? [BRAND.bg, BRAND.surfaceElevated];
  return (
    `gradients=s=${VIDEO.width}x${VIDEO.height}:r=${VIDEO.fps}:d=${hold.toFixed(3)}` +
    `:n=3:speed=0.01:c0=0x${c0.replace("#", "")}:c1=0x${c1.replace("#", "")}` +
    `:c2=0x${BRAND.bg.replace("#", "")}`
  );
}

/**
 * Build one scene's clip.
 *
 * The still is fed as a single frame rather than a looped stream, so `zoompan` owns the
 * whole timeline: it receives one frame and emits exactly `frames` of them, moving in
 * between. Looping the image first would give `zoompan` many input frames, each restarting
 * the move, which produces a stutter that looks like a broken encode rather than a bug in
 * the filter graph.
 */
async function renderClip(scene, clip, quality, clipQuality, overlayPath, { force = false, quiet = true }) {
  const dir = join(BUILD, "clips");
  await mkdir(dir, { recursive: true });
  const out = join(dir, `${scene.id}.mp4`);
  const hold = clip.holdSeconds;
  const frames = Math.round(hold * VIDEO.fps);
  const hasFootage = Boolean(scene.visual.asset);

  // The overlay is a pure function of the scene, so its *source* identifies it. Using the
  // rendered PNG's timestamp instead would invalidate every clip on every run, because the
  // overlay pass rewrites all of them, and a cache that always misses is not a cache.
  const fingerprint = hashOf(
    overlayDocument(scene),
    clip.fingerprint,
    hold.toFixed(4),
    JSON.stringify({ quality, clipQuality }),
    hasFootage ? await stamp(join(ASSETS, `${scene.visual.asset}.png`)) : "gradient",
  );
  const stampFile = join(dir, `${scene.id}.stamp`);
  if (!force && (await exists(out)) && (await readFile(stampFile, "utf8").catch(() => "")) === fingerprint) {
    return { file: out, cached: true, hold };
  }

  const inputs = [];
  if (hasFootage) {
    inputs.push("-i", overlayAsset(scene.visual.asset, "png"));
  } else {
    inputs.push("-f", "lavfi", "-i", gradientInput(scene, hold));
  }
  inputs.push("-loop", "1", "-framerate", String(VIDEO.fps), "-t", hold.toFixed(3), "-i", overlayPath);
  inputs.push("-i", clip.file);

  const overlayIndex = 1;
  const audioIndex = 2;
  const { width, height, scale } = quality;

  const background = hasFootage
    ? (() => {
        const { z, x, y } = motionExpr(scene.visual.motion, frames);
        return (
          `[0:v]scale=${scale}:-2:flags=lanczos,setsar=1,` +
          `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${width}x${height}:fps=${VIDEO.fps},` +
          `fps=${VIDEO.fps},format=yuv420p[bg]`
        );
      })()
    : `[0:v]scale=${width}:${height}:flags=lanczos,setsar=1,fps=${VIDEO.fps},format=yuv420p[bg]`;

  // The overlay fades rather than cuts, and rises into place over the same interval. The
  // rise is expressed in frames because `overlay`'s `y` is evaluated per frame.
  const riseFrames = Math.round(MOTION.fadeIn * VIDEO.fps);
  const fadeOutAt = Math.max(0, hold - MOTION.fadeOut);
  const overlay =
    `[${overlayIndex}:v]format=rgba,` +
    `fade=t=in:st=0:d=${MOTION.fadeIn}:alpha=1,` +
    `fade=t=out:st=${fadeOutAt.toFixed(3)}:d=${MOTION.fadeOut}:alpha=1[ov]`;

  const composite =
    `[bg][ov]overlay=x=0:y='if(lt(n\\,${riseFrames})\\,(1-n/${riseFrames})*${MOTION.rise}\\,0)':` +
    `format=auto,fps=${VIDEO.fps},format=yuv420p[v]`;

  // The pause after the narration is what the cross-dissolve lands in. Padding the audio to
  // the scene's full length keeps every clip's audio and video the same duration, which is
  // what makes the transition offsets in `timeline()` exact.
  const audio =
    `[${audioIndex}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
    `apad=whole_dur=${hold.toFixed(3)},atrim=0:${hold.toFixed(3)},asetpts=N/SR/TB[a]`;

  await ffmpeg([
    ...inputs,
    "-filter_complex",
    `${background};${overlay};${composite};${audio}`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-t",
    hold.toFixed(3),
    "-r",
    String(VIDEO.fps),
    "-c:v",
    "libx264",
    "-preset",
    clipQuality.preset,
    "-crf",
    clipQuality.crf,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    out,
  ]);

  await writeFile(stampFile, fingerprint);
  if (!quiet) console.log(`  · clip ${scene.id} (${hold.toFixed(1)}s)`);
  return { file: out, cached: false, hold };
}

function overlayAsset(name, extension) {
  return join(ASSETS, `${name}.${extension}`);
}

/**
 * Identity of a file on disk.
 *
 * Size and modification time, rather than a content hash: these inputs are multi-megabyte
 * PNGs produced by a capture step, and hashing every one of them on every render would add
 * seconds to the common case (nothing changed) to make an already-narrow staleness window
 * narrower.
 */
async function stamp(path) {
  try {
    const info = await stat(path);
    return `${relative(REPO, path)}@${info.size}:${Math.round(info.mtimeMs)}`;
  } catch {
    return `${relative(REPO, path)}@missing`;
  }
}

function hashOf(...parts) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}

/* ────────────────────────────── assembly ────────────────────────────── */

/* ────────────────────── composition and finishing ────────────────────── */

/**
 * The audio bed.
 *
 * Synthesised rather than licensed: three tones a fifth and an octave apart, low-passed
 * and put under a slow swell, at a level chosen to sit beneath speech rather than compete
 * with it. Generating it means the repository carries no third-party audio and no licence
 * obligation for a four-minute internal deliverable, and it is far below the narration, so
 * a listener notices its absence rather than its presence.
 */
async function musicBed(seconds, { quiet = true } = {}) {
  const out = join(BUILD, "music.wav");
  const fingerprint = hashOf(seconds.toFixed(2), "pad-v1");
  const stampFile = join(BUILD, "music.stamp");
  if ((await exists(out)) && (await readFile(stampFile, "utf8").catch(() => "")) === fingerprint) {
    return out;
  }
  const fadeOutAt = Math.max(0, seconds - 8);
  const expr =
    "0.30*sin(2*PI*110*t)+0.22*sin(2*PI*164.81*t)+0.16*sin(2*PI*220*t)";
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=${expr}:s=48000:d=${seconds.toFixed(2)}`,
    "-af",
    // tremolo's frequency floor is 0.1Hz; below it ffmpeg refuses the graph outright.
    `lowpass=f=420,tremolo=f=0.11:d=0.4,` +
      `afade=t=in:st=0:d=6,afade=t=out:st=${fadeOutAt.toFixed(2)}:d=8,` +
      `aformat=channel_layouts=stereo`,
    out,
  ]);
  await writeFile(stampFile, fingerprint);
  if (!quiet) console.log(`  · music bed (${seconds.toFixed(0)}s, synthesised)`);
  return out;
}

/**
 * Cross-dissolve the clips, draw the finishing elements, mix the audio, and encode — all
 * in one filter graph.
 *
 * One pass rather than an assemble step followed by a finishing step, for quality: every
 * additional encode of the same frames is another generation of compression artefacts, and
 * a progress bar and a watermark are not worth spending one on.
 *
 * The progress bar is driven by the timestamp, so it tracks the real length of the cut
 * rather than an assumed one, and the mix is loudness-normalised to the web target so the
 * video plays back at a comparable level to anything else opened in the same browser tab.
 */
async function assemble(clips, offsets, out, quality, { quiet = true } = {}) {
  await mkdir(dirname(out), { recursive: true });
  const fingerprint = hashOf(
    ...(await Promise.all(clips.map((clip) => stamp(clip.file)))),
    offsets.map((o) => o.toFixed(3)).join(","),
    JSON.stringify(quality),
  );
  const stampFile = `${out}.stamp`;
  if ((await exists(out)) && (await readFile(stampFile, "utf8").catch(() => "")) === fingerprint) {
    return out;
  }

  const inputs = clips.flatMap((clip) => ["-i", clip.file]);
  const filters = [];
  let v = "[0:v]";
  let a = "[0:a]";
  for (let index = 1; index < clips.length; index += 1) {
    const offset = offsets[index - 1];
    filters.push(
      `${v}[${index}:v]xfade=transition=fade:duration=${VIDEO.transition}:` +
        `offset=${offset.toFixed(3)}[v${index}]`,
    );
    filters.push(`${a}[${index}:a]acrossfade=d=${VIDEO.transition}:c1=tri:c2=tri[a${index}]`);
    v = `[v${index}]`;
    a = `[a${index}]`;
  }

  // Near-lossless: this file is decoded again by the finishing pass, so quality is spent
  // once, at the end. `ultrafast` trades a larger intermediate for a materially shorter
  // build, which matters because this pass is the most expensive step in the pipeline.
  await ffmpeg([
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    v,
    "-map",
    a,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    out,
  ]);
  await writeFile(stampFile, fingerprint);
  if (!quiet) console.log(`  · assembled ${clips.length} clips`);
  return out;
}

/**
 * The finishing pass: progress bar, watermark, audio bed, loudness, delivery encode.
 *
 * Kept separate from assembly so that it is re-run on its own when only the finishing
 * changes — and because a single graph holding fourteen decoders, the cross-dissolve, the
 * mix, and the delivery encode is slow enough to matter on a rebuild.
 */
async function finish(input, out, total, quality, { quiet = true } = {}) {
  await mkdir(dirname(out), { recursive: true });
  const bed = await musicBed(total, { quiet });
  const font = await fontFile();
  const barHeight = 8;
  // Interpolated into a filter graph, where an unescaped space would end the option.
  const fontArg = font ? font.replace(/([:'\\ ])/g, "\\$1") : null;

  const filters = [];

  // A full-width bar slid in from the left, so its right edge is the progress edge.
  //
  // This is not the obvious construction, and the obvious ones do not work. `drawbox`
  // cannot animate: its `t` is the box *thickness*, not the timestamp, so a width written
  // against `t` silently renders a full-width bar on every frame — which is exactly the
  // bug the verification pass caught. `geq` does expose the timestamp, but it has no
  // variable for the source pixel, so it cannot pass the colour through. `overlay`'s `x`
  // is a genuine time expression, and the visible part of a bar hanging off the left edge
  // at `x = -w(1 - t/D)` is precisely the first `W*t/D` pixels.
  const barColour = BRAND.violet.replace("#", "");
  filters.push(
    `color=c=0x${barColour}@0.92:s=${quality.width}x${barHeight}:r=${VIDEO.fps}:d=${total.toFixed(3)}[bar]`,
    `[0:v][bar]overlay=x='-w*(1-t/${total.toFixed(3)})':y=H-${barHeight}:format=auto[vbar]`,
  );
  let videoOut = "[vbar]";
  if (fontArg) {
    filters.push(
      `${videoOut}drawtext=fontfile=${fontArg}:text='zizalend.vercel.app':` +
        `x=w-tw-46:y=h-th-${barHeight + 26}:fontsize=26:fontcolor=white@0.5[vmark]`,
    );
    videoOut = "[vmark]";
  }

  filters.push(
    `[0:a]volume=1.0[voice]`,
    `[1:a]volume=0.05[bedmix]`,
    `[voice][bedmix]amix=inputs=2:duration=first:dropout_transition=0,` +
      `loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`,
  );

  await ffmpeg([
    "-i",
    input,
    "-i",
    bed,
    "-filter_complex",
    filters.join(";"),
    "-map",
    videoOut,
    "-map",
    "[aout]",
    "-t",
    total.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    quality.preset,
    "-crf",
    quality.crf,
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    out,
  ]);
  if (!quiet) console.log(`  · finished -> ${relative(REPO, out)}`);
  return out;
}

/**
 * Pick a thumbnail: the hook scene, once its overlay has finished rising.
 *
 * A frame from the finished video rather than a separately composed card, so the thumbnail
 * cannot promise something the video does not contain.
 */
async function thumbnail(video, scenes, timelineInfo, quality) {
  const hookIndex = scenes.findIndex((s) => s.id === "hook");
  if (hookIndex === -1) return null;
  const at = timelineInfo.clips
    .slice(0, hookIndex)
    .reduce((sum, c) => sum + c.holdSeconds, 0) + MOTION.fadeIn + 0.6;

  await mkdir(OUT, { recursive: true });
  await ffmpeg([
    "-ss",
    at.toFixed(2),
    "-i",
    video,
    "-frames:v",
    "1",
    "-vf",
    `scale=${quality.width}:${quality.height}:flags=lanczos`,
    ARTIFACTS.thumbnail,
  ]);
  return ARTIFACTS.thumbnail;
}

/* ────────────────────────────── entrypoint ────────────────────────────── */

/**
 * Build the video.
 *
 * @param {{ draft?: boolean, force?: boolean, skipCapture?: boolean, quiet?: boolean }} options
 */
export async function render({ draft = false, force = false, quiet = false } = {}) {
  const quality = draft ? QUALITY.draft : QUALITY.final;
  await mkdir(BUILD, { recursive: true });
  await mkdir(OUT, { recursive: true });

  const manifestPath = join(ASSETS, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const captured = new Set(manifest.assets ?? []);

  // A scene whose footage is missing would render as a black frame in the middle of the
  // video, which is the kind of defect that is invisible until it is embarrassing.
  const missing = SCENES.filter((s) => s.visual.asset && !captured.has(s.visual.asset)).map(
    (s) => `${s.id} -> ${s.visual.asset}`,
  );
  if (missing.length) {
    throw new Error(
      `missing footage for ${missing.length} scene(s); run \`node capture.mjs\` first:\n  ` +
        missing.join("\n  "),
    );
  }

  if (!quiet) console.log("narration");
  const audio = await narrate({ force, quiet });
  const time = timeline(audio);

  if (!quiet) console.log("overlays");
  const overlays = await renderOverlays(SCENES, { quiet });
  const overlayFor = new Map(overlays.map((o) => [o.id, o.path]));

  if (!quiet) console.log(`clips (${draft ? "draft" : "final"} quality)`);
  const clipQuality = draft ? CLIP_QUALITY.draft : CLIP_QUALITY.final;
  const clips = [];
  for (const [index, scene] of SCENES.entries()) {
    const result = await renderClip(
      scene,
      time.clips[index],
      quality,
      clipQuality,
      overlayFor.get(scene.id),
      { force, quiet },
    );
    clips.push(result);
  }
  const built = clips.filter((c) => !c.cached).length;

  const out = draft ? join(BUILD, "draft.mp4") : ARTIFACTS.video;
  const assembled = await assemble(clips, time.offsets, join(BUILD, "assembled.mp4"), quality, {
    quiet,
  });
  await finish(assembled, out, time.total, quality, { quiet });
  if (!draft) await thumbnail(out, SCENES, time, quality);

  if (!quiet) {
    console.log(
      `\nrendered ${SCENES.length} scenes (${built} rebuilt, ${clips.length - built} cached)\n` +
        `  duration ${time.total.toFixed(1)}s (${(time.total / 60).toFixed(2)} min)\n` +
        `  output   ${relative(REPO, out)}`,
    );
  }
  return { file: out, total: time.total, clips, time, draft };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const draft = process.argv.includes("--draft");
  const force = process.argv.includes("--force");
  const started = Date.now();
  const result = await render({ draft, force });
  console.log(`  elapsed  ${((Date.now() - started) / 1000).toFixed(0)}s`);
}
