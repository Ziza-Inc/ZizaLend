"use client";

import { useEffect } from "react";
import { useGamificationStore } from "../../stores/useGamificationStore";
import { XPGainAnimation } from "../gamification/XPGainAnimation";
import { useSoundEffect } from "../../utils/soundManager";

/**
 * Renders the queued "+N XP" chips, one at a time.
 *
 * The queue is read straight from the gamification store. It used to be rebuilt
 * into local `useState` from two effects — one to enqueue `recentXPGain`, one to
 * promote the head of the queue — and both were synchronous `setState` calls
 * inside an effect. Keeping the queue in the store removes the mirror entirely:
 * React reads it, `addXP` writes it, and nothing has to be copied back and
 * forth on every change.
 */
export function GlobalXPGain() {
  const queue = useGamificationStore((state) => state.xpGainQueue);
  const shiftXPGain = useGamificationStore((state) => state.shiftXPGain);
  const soundEnabled = useGamificationStore((state) => state.soundEnabled);
  const sound = useSoundEffect();

  const activeGain = queue[0] ?? null;
  const activeId = activeGain?.id ?? null;

  useEffect(() => {
    if (activeId === null || !soundEnabled) return;
    sound.play("xpGain");
  }, [activeId, soundEnabled, sound]);

  return (
    <div className="pointer-events-none">
      {/* Keyed per gain so the chip remounts — and its dismissal timer restarts
          — for each queued award. */}
      <XPGainAnimation
        key={activeId ?? "idle"}
        amount={activeGain?.amount ?? 0}
        show={activeGain !== null}
        onComplete={shiftXPGain}
        position="top"
      />
    </div>
  );
}
