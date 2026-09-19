"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface XPGainAnimationProps {
  amount: number;
  show: boolean;
  onComplete?: () => void;
  position?: "top" | "center" | "bottom";
}

/** How long the chip stays on screen before the owner is told it is finished. */
export const XP_GAIN_DISPLAY_MS = 2000;

const POSITION_CLASSES: Record<NonNullable<XPGainAnimationProps["position"]>, string> = {
  top: "top-4",
  center: "top-1/2 -translate-y-1/2",
  bottom: "bottom-4",
};

/**
 * A transient "+N XP" chip.
 *
 * The hide is driven by a timeout that flips local `dismissed` state from inside
 * a callback rather than synchronously in the effect body, so it does not trip
 * `react-hooks/set-state-in-effect`. `onComplete` is read through a ref so a new
 * inline callback identity does not restart the timer on every parent render —
 * the previous version listed `onComplete` as a dependency and therefore reset
 * the two-second window each time its parent re-rendered.
 *
 * Give the component a fresh `key` per gain so `dismissed` starts over.
 */
export function XPGainAnimation({
  amount,
  show,
  onComplete,
  position = "top",
}: XPGainAnimationProps) {
  const [dismissed, setDismissed] = useState(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!show) return;

    const timer = setTimeout(() => {
      setDismissed(true);
      onCompleteRef.current?.();
    }, XP_GAIN_DISPLAY_MS);

    return () => clearTimeout(timer);
  }, [show]);

  const isVisible = show && !dismissed;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.5, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: -20 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className={`fixed left-1/2 ${POSITION_CLASSES[position]} z-50 -translate-x-1/2`}
        >
          <div className="flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-3 shadow-lg">
            <motion.div
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            >
              <Sparkles size={20} className="text-yellow-300" />
            </motion.div>
            <span className="text-lg font-bold text-white">+{amount} XP</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
