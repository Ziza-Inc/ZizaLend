"use client";

import { useSyncExternalStore } from "react";

/**
 * useHydrated
 *
 * Returns `false` during SSR and the very first client render, then flips
 * to `true` after hydration. Use this to gate components that read from
 * client-only sources (localStorage, persisted Zustand stores,
 * `window.matchMedia`, etc.) so they avoid SSR/CSR DOM mismatches.
 *
 * Implemented with `useSyncExternalStore` rather than the
 * `useState(false)` + `useEffect(() => setMounted(true))` pair. That pair is a
 * synchronous `setState` inside an effect (`react-hooks/set-state-in-effect`)
 * whose only job is to schedule a second render pass to flip one boolean.
 * Hydration *is* external state that React already tracks, so subscribing to it
 * is both cheaper and impossible to desynchronise.
 */
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
