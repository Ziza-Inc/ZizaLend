/**
 * The on-screen text layer of the pitch video.
 *
 * One function per overlay `kind`, each returning a standalone HTML document at the exact
 * frame geometry. `render.mjs` screenshots these with a transparent background, so each
 * one is a PNG with an alpha channel that ffmpeg composites over the footage. Nothing is
 * baked into the footage itself, which is what lets the underlying shot keep its motion
 * while the text fades and rises independently.
 *
 * Two layouts, chosen automatically:
 *
 *   - a scene whose background is a generated gradient has nothing behind it to preserve,
 *     so its overlay is composed as a centred hero;
 *   - a scene with real footage keeps that footage visible and puts the text in a
 *     bottom-weighted band over a scrim.
 *
 * Getting that choice backwards is the difference between a video that shows the product
 * and one that shows slides with a product behind them.
 *
 * Colours and type come from `scenes.mjs`, which took them from the frontend's CSS custom
 * properties, so an overlay cannot drift from the product's own branding.
 */

import { VIDEO, BRAND } from "./scenes.mjs";

/** Every overlay kind this module knows how to draw. Checked by `verify.mjs`. */
export const OVERLAY_KINDS = ["stats", "lowerThird", "title", "callouts", "closing"];

/** Frame-edge padding. Keeps text clear of the frame and of a player's own chrome. */
const MARGIN = { x: 104, y: 84 };

const FONT_STACK = `"DejaVu Sans", "Liberation Sans", "Helvetica Neue", system-ui, sans-serif`;
const MONO_STACK = `"DejaVu Sans Mono", "Liberation Mono", monospace`;

/**
 * The shared stylesheet.
 *
 * The scrim is not decoration. White body text over an arbitrary screenshot is
 * unreadable as soon as the shot has a light region behind it, and the shots here are a
 * dark app and GitHub's light UI. A gradient scrim guarantees the contrast without
 * dimming the part of the frame the text is not over.
 */
function styles() {
  return `
  :root {
    --violet: ${BRAND.violet};
    --violet-soft: ${BRAND.violetSoft};
    --teal: ${BRAND.teal};
    --text: ${BRAND.text};
    --secondary: ${BRAND.textSecondary};
    --muted: ${BRAND.textMuted};
    --border: ${BRAND.border};
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    width: ${VIDEO.width}px;
    height: ${VIDEO.height}px;
    overflow: hidden;
    position: relative;
    font-family: ${FONT_STACK};
    color: var(--text);
    -webkit-font-smoothing: antialiased;
  }

  /* Scrims.
     \`band\` darkens the lower third and leaves the rest of the frame untouched.
     \`hero-light\` is for a centred composition over real footage: enough darkening to
     hold white text, not so much that the product behind it disappears — an opaque scrim
     on a scene whose whole purpose is to show the application would hide the thing it is
     talking about.
     \`hero-strong\` is for a scene with a generated gradient behind it, where there is no
     footage to preserve and full contrast is what makes the text land. */
  .scrim-band {
    position: absolute; inset: auto 0 0 0; height: 62%;
    background: linear-gradient(
      to top,
      rgba(6, 6, 10, 0.94) 0%,
      rgba(6, 6, 10, 0.86) 26%,
      rgba(6, 6, 10, 0.58) 54%,
      rgba(6, 6, 10, 0.0) 100%
    );
  }
  .scrim-hero-light {
    position: absolute; inset: 0;
    background:
      radial-gradient(1500px 900px at 50% 46%, rgba(6,6,10,0.30), rgba(6,6,10,0.60) 82%),
      linear-gradient(to top, rgba(6,6,10,0.74), rgba(6,6,10,0.16) 72%);
  }
  .scrim-hero-strong {
    position: absolute; inset: 0;
    background:
      radial-gradient(1200px 700px at 50% 50%, rgba(6,6,10,0.72), rgba(6,6,10,0.9) 78%),
      linear-gradient(to top, rgba(6,6,10,0.95), rgba(6,6,10,0.55) 65%);
  }

  .layer {
    position: absolute; inset: 0;
    padding: ${MARGIN.y}px ${MARGIN.x}px;
    display: flex; flex-direction: column;
  }
  .layer.hero { justify-content: center; align-items: center; text-align: center; }
  .layer.band { justify-content: flex-end; }

  .eyebrow {
    display: inline-flex; align-items: center; gap: 14px;
    font-size: 20px; font-weight: 700; letter-spacing: 0.24em; text-transform: uppercase;
    color: var(--teal); margin-bottom: 20px;
  }
  .eyebrow::before {
    content: ""; width: 46px; height: 3px; background: var(--teal); display: block;
    border-radius: 2px;
  }
  .layer.hero .eyebrow::before { display: none; }

  h1 {
    font-size: 60px; line-height: 1.08; letter-spacing: -0.022em;
    margin: 0 0 16px; font-weight: 700; max-width: 1500px;
  }
  h1.hero { font-size: 78px; }
  h1 .accent { color: var(--violet-soft); }

  .subtitle {
    font-size: 28px; color: var(--secondary); line-height: 1.45; margin: 0; max-width: 1180px;
  }

  ul.points { list-style: none; margin: 0; padding: 0; }
  ul.points li {
    position: relative; padding-left: 40px; margin: 0 0 14px;
    font-size: 27px; line-height: 1.4; color: var(--secondary);
  }
  ul.points li::before {
    content: ""; position: absolute; left: 8px; top: 15px;
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--violet); box-shadow: 0 0 0 5px rgba(124, 58, 237, 0.18);
  }
  ul.points li:last-child { margin-bottom: 0; }

  /* Stats. The value carries the number, the label explains it, and neither is allowed
     to wrap — a two-line stat is a stat nobody reads mid-sentence. */
  .stats { display: flex; gap: 78px; align-items: flex-end; }
  .layer.hero .stats { gap: 108px; justify-content: center; }
  .stat .value {
    font-size: 104px; line-height: 0.96; font-weight: 700; letter-spacing: -0.03em;
    color: var(--violet-soft); white-space: nowrap;
  }
  .stat .label {
    margin-top: 14px; font-size: 23px; color: var(--secondary);
    max-width: 420px; line-height: 1.35;
  }
  .footer {
    margin-top: 42px; font-size: 24px; color: var(--muted); letter-spacing: 0.01em;
  }
  .layer.hero .footer { text-align: center; }

  /* Callouts point at a region of the footage rather than describing it in a list. */
  .callout {
    position: absolute; display: flex; align-items: center; gap: 16px;
    transform: translate(-50%, -50%);
  }
  .callout .dot {
    width: 18px; height: 18px; border-radius: 50%; flex: none;
    background: var(--teal);
    box-shadow: 0 0 0 7px rgba(14, 207, 207, 0.22), 0 0 22px rgba(14, 207, 207, 0.55);
  }
  .callout .text {
    font-size: 25px; font-weight: 600; color: var(--text); white-space: nowrap;
    background: rgba(13, 13, 18, 0.82);
    border: 1px solid var(--border);
    border-left: 3px solid var(--teal);
    border-radius: 10px;
    padding: 13px 22px;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.55);
  }

  /* Closing card. */
  .links { display: flex; flex-direction: column; gap: 20px; margin-top: 48px; }
  .link {
    display: flex; align-items: baseline; gap: 22px;
    font-size: 27px; padding-bottom: 18px;
    border-bottom: 1px solid rgba(42, 42, 58, 0.85);
  }
  .link:last-child { border-bottom: none; }
  .link .label { color: var(--text); font-weight: 600; min-width: 470px; text-align: left; }
  .link .value { color: var(--muted); }
  .mono { font-family: ${MONO_STACK}; }
  `;
}

/**
 * Wrap overlay body markup in the full document, the scrim, and the shared styles.
 *
 * `extra` is rendered as a sibling of the text layer, inside `body` (which is the
 * positioned ancestor), which is what lets a callout sit anywhere in the frame instead of
 * only in the band the text occupies.
 */
/**
 * @param {{ body: string, layout: "hero"|"band", extra?: string, scrim?: "light"|"strong" }} options
 */
function document({ body, layout, extra = "", scrim = "strong" }) {
  const className =
    layout === "hero" ? `scrim-hero-${scrim}` : "scrim-band";
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>${styles()}</style></head>
<body>
  <div class="${className}"></div>
  <div class="layer ${layout}">${body}</div>
  ${extra}
</body></html>`;
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Mark up the few inline conventions the narration text is allowed to carry: `code`
 * spans and an `*emphasis*` that renders in the accent colour. Deliberately not a
 * Markdown parser — the overlays use two constructs and pulling in a full implementation
 * to draw them would be a dependency for a tool that runs on one machine.
 */
function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, `<span class="mono">$1</span>`)
    .replace(/\*([^*]+)\*/g, `<span class="accent">$1</span>`);
}

function eyebrow(text) {
  return text ? `<div class="eyebrow">${esc(text)}</div>` : "";
}

function statsOverlay(overlay, layout, scrim) {
  const items = (overlay.items ?? [])
    .map(
      (item) => `
      <div class="stat">
        <div class="value">${esc(item.value)}</div>
        <div class="label">${esc(item.label)}</div>
      </div>`,
    )
    .join("");
  const body = `
    ${eyebrow(overlay.eyebrow)}
    <div class="stats">${items}</div>
    ${overlay.footer ? `<div class="footer">${esc(overlay.footer)}</div>` : ""}`;
  return document({ body, layout, scrim });
}

function lowerThirdOverlay(overlay, layout, scrim) {
  const points = (overlay.points ?? []).map((p) => `<li>${inline(p)}</li>`).join("");
  const body = `
    <div>
      ${eyebrow(overlay.eyebrow)}
      <h1>${inline(overlay.title)}</h1>
      ${points ? `<ul class="points">${points}</ul>` : ""}
    </div>`;
  return document({ body, layout, scrim });
}

function titleOverlay(overlay, layout, scrim) {
  const body = `
    ${eyebrow(overlay.eyebrow)}
    <h1 class="hero mono">${inline(overlay.title)}</h1>
    ${overlay.subtitle ? `<p class="subtitle">${inline(overlay.subtitle)}</p>` : ""}`;
  return document({ body, layout: "hero", scrim });
}

/**
 * Positioned callouts.
 *
 * `at` is a fraction of the frame, not a pixel offset, so a callout keeps pointing at the
 * same part of the UI even if the shot is re-captured at a different scale. Coordinates
 * are clamped away from the very edge: a chip centred at 0.98 would be half off-frame.
 */
function calloutsOverlay(overlay, layout, scrim) {
  const chips = (overlay.items ?? [])
    .map(({ at: [x, y], text }) => {
      const left = Math.min(0.88, Math.max(0.12, x)) * 100;
      const top = Math.min(0.9, Math.max(0.1, y)) * 100;
      return `<div class="callout" style="left: ${left}%; top: ${top}%;">
        <div class="dot"></div>
        <div class="text">${inline(text)}</div>
      </div>`;
    })
    .join("");
  const body = `
    <div>
      ${eyebrow(overlay.eyebrow)}
      <h1>${inline(overlay.title)}</h1>
    </div>`;
  return document({ body, layout, extra: chips, scrim });
}

function closingOverlay(overlay, layout, scrim) {
  const links = (overlay.links ?? [])
    .map(
      (l) => `
      <div class="link">
        <span class="label">${esc(l.label)}</span>
        <span class="value">${esc(l.value)}</span>
      </div>`,
    )
    .join("");
  const body = `
    <h1 class="hero">${inline(overlay.title)}</h1>
    <div class="links">${links}</div>`;
  return document({ body, layout: "hero", scrim });
}

const RENDERERS = {
  stats: statsOverlay,
  lowerThird: lowerThirdOverlay,
  title: titleOverlay,
  callouts: calloutsOverlay,
  closing: closingOverlay,
};

/**
 * How a kind enters and leaves the frame, as a fraction of the scene.
 *
 * Kept beside the templates because it is a property of the design: a lower third that
 * slides a long way reads as a PowerPoint build, and a centred title that does not move
 * at all reads as a slide. `overlays.mjs` owns both the look and the entry.
 */
export const MOTION = {
  /** Pixels of upward travel for the band layouts. */
  rise: 46,
  /** Seconds the overlay takes to fade in, and to fade out at the end of the scene. */
  fadeIn: 0.65,
  fadeOut: 0.55,
};

/**
 * Build the overlay document for one scene.
 *
 * A scene with no `visual.asset` has a generated gradient behind it and therefore gets the
 * centred layout; a scene with footage keeps the footage by using the band.
 *
 * The hero scrim follows the same distinction. A centred overlay is almost always over a
 * generated gradient, where full darkening is what makes the text land; the exception is a
 * scene that centres its text over real footage, and there the scrim is the light one —
 * otherwise the overlay hides the application the scene is describing.
 */
export function overlayDocument(scene) {
  const overlay = scene.overlay ?? {};
  const kind = overlay.kind;
  const render = RENDERERS[kind];
  if (!render) {
    throw new Error(
      `scene ${JSON.stringify(scene.id)} has unknown overlay kind ${JSON.stringify(kind)}; ` +
        `known kinds: ${OVERLAY_KINDS.join(", ")}`,
    );
  }
  const hasFootage = Boolean(scene.visual?.asset);
  const layout = hasFootage ? "band" : "hero";
  const scrim = hasFootage ? "light" : "strong";
  return render(overlay, layout, scrim);
}
