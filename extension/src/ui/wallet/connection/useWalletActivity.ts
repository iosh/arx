import { WalletChannelDisconnectedError, type WalletClient } from "@arx/wallet-api/client";
import { useEffect } from "react";

const ACTIVITY_INTERVAL_MS = 1_000;
const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "input", "click"] as const;
const LISTENER_OPTIONS = { capture: true, passive: true } as const;

export function useWalletActivity(wallet: WalletClient, unlocked: boolean): void {
  useEffect(() => {
    if (!unlocked) return;

    let stopped = false;
    let lastNotifiedAt = -Infinity;

    const handleInput = (event: Event) => {
      if (!event.isTrusted || document.visibilityState !== "visible") return;

      const now = performance.now();
      if (now - lastNotifiedAt < ACTIVITY_INTERVAL_MS) return;
      lastNotifiedAt = now;
      void wallet.notifyUserActivity().catch(handleFailure);
    };

    const removeInputListeners = () => {
      for (const event of INPUT_EVENTS) document.removeEventListener(event, handleInput, LISTENER_OPTIONS);
    };

    const stop = () => {
      stopped = true;
      removeInputListeners();
    };

    function handleFailure(error: unknown): void {
      if (stopped) return;
      if (error instanceof WalletChannelDisconnectedError) {
        stop();
      } else {
        console.error("[arx:ui] Failed to track wallet activity", error);
      }
    }

    for (const event of INPUT_EVENTS) document.addEventListener(event, handleInput, LISTENER_OPTIONS);

    return stop;
  }, [wallet, unlocked]);
}
