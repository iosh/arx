import { useEffect, useRef } from "react";
import { uiClient } from "../lib/uiBridgeClient";

const DEBOUNCE_MS = 2_000;
const MIN_INTERVAL_MS = 10_000;

export const useIdleTimer = (enabled: boolean) => {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNotifyRef = useRef(0);

  useEffect(() => {
    const cleanup = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    if (!enabled) {
      cleanup();
      return cleanup;
    }

    const schedule = (delay = DEBOUNCE_MS) => {
      cleanup();
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        const now = Date.now();
        if (now - lastNotifyRef.current >= MIN_INTERVAL_MS) {
          lastNotifyRef.current = now;
          void uiClient.session.resetAutoLockTimer();
        } else {
          const remaining = MIN_INTERVAL_MS - (now - lastNotifyRef.current);
          schedule(Math.max(remaining, DEBOUNCE_MS));
        }
      }, delay);
    };

    const handleActivity = () => {
      schedule();
    };

    const events: Array<keyof WindowEventMap> = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"];
    for (const event of events) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    schedule();

    return () => {
      for (const event of events) {
        window.removeEventListener(event, handleActivity);
      }
      cleanup();
    };
  }, [enabled]);
};
