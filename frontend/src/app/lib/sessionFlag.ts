"use client";

/**
 * A per-session boolean flag, stored in `sessionStorage` and exposed as an
 * external store so components can read it through `useSyncExternalStore`.
 *
 * The alternative — `useState` plus a `useEffect` that reads storage and calls
 * `setState` — is a synchronous `setState` inside an effect
 * (`react-hooks/set-state-in-effect`), and worse, it renders one frame with the
 * flag in the wrong position. Reading it as external state removes both the
 * extra render pass and the flash of a UI element the user already dismissed.
 *
 * Storage access is wrapped because `sessionStorage` throws when storage is
 * disabled (Safari private mode, blocked cookies). A dismissible banner is a
 * convenience, so failing to persist it must not take the page down.
 */

const listeners = new Map<string, Set<() => void>>();

function listenersFor(key: string): Set<() => void> {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  return set;
}

export function subscribeToSessionFlag(key: string, listener: () => void): () => void {
  const set = listenersFor(key);
  set.add(listener);

  return () => {
    set.delete(listener);
  };
}

export function readSessionFlag(key: string): boolean {
  if (typeof window === "undefined") return false;

  try {
    return window.sessionStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

export function writeSessionFlag(key: string, value: boolean): void {
  try {
    window.sessionStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Not persistable; the in-memory listeners below still update the UI.
  }

  for (const listener of listenersFor(key)) listener();
}
