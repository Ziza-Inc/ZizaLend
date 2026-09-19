"use client";

import { useSyncExternalStore } from "react";

/**
 * The wall clock, exposed as an external store.
 *
 * Reading `Date.now()` during render is impure: two renders of the same tree can
 * disagree, and React 19's compiler lint (`react-hooks/purity`) rejects it
 * outright. Going through a store keeps the render pure — the value only moves
 * when the store says so — and hands every subscriber the *same* instant, which
 * is what makes "is this loan due within 72 hours?" agree across a tree.
 *
 * The snapshot is refreshed once a minute, which is finer than anything the UI
 * displays (hours left, due date). Server and hydrating renders receive `0`, so
 * no time-dependent output is baked into the HTML and hydration cannot mismatch;
 * callers treat `0` as "not yet known" and render nothing time-dependent.
 */
const TICK_MS = 60_000;

let currentNow = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  currentNow = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  if (timer === null) {
    currentNow = Date.now();
    timer = setInterval(tick, TICK_MS);
    // Node keeps the event loop alive for a pending interval; the browser has no
    // `unref`, hence the optional call.
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export const getNowSnapshot = () => currentNow;

/** `0` on the server and during hydration, so nothing time-dependent is baked in. */
export const getServerNowSnapshot = () => 0;

/**
 * The current time in milliseconds, or `0` before the client has hydrated.
 *
 * Callers must treat `0` as "unknown" rather than as the epoch — comparing a
 * deadline against `0` must not accidentally match.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getNowSnapshot, getServerNowSnapshot);
}
