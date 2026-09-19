"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Makes every framer-motion animation in the tree honour the visitor's
 * `prefers-reduced-motion` setting.
 *
 * `reducedMotion="user"` is framer-motion's own support for the media query: it
 * skips transform, layout and rotate animations while keeping opacity fades, so
 * a motion-sensitive visitor loses the movement but not the information a
 * transition carries — a dialog still appears, it just does not slide or scale.
 * Blanket-disabling animation instead would make several of these components
 * appear abruptly, and in a few cases never reach their end state.
 *
 * The CSS half lives in `globals.css` and covers what framer-motion does not
 * own: `animate-shimmer`, `animate-dot-bounce`, `animate-reverse-spin`,
 * `animate-fade-in-up` and Tailwind's `transition-*` / `duration-*` utilities.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
