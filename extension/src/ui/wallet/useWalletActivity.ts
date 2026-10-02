import type { WalletStatus } from "@arx/core/wallet";
import { WalletChannelDisconnectedError, type WalletClient } from "@arx/wallet-api/client";
import { useEffect } from "react";

const ACTIVITY_INTERVAL_MS = 1_000;
const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "input", "click"] as const;
const LISTENER_OPTIONS = { capture: true, passive: true } as const;

export function useWalletActivity(wallet: WalletClient): void {
  useEffect(() => {
    let status: WalletStatus | undefined;
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

    const applyStatus = (nextStatus: WalletStatus) => {
      if (stopped || status === nextStatus) return;
      status = nextStatus;
      if (status === "unlocked") {
        lastNotifiedAt = -Infinity;
        for (const event of INPUT_EVENTS) document.addEventListener(event, handleInput, LISTENER_OPTIONS);
      } else {
        removeInputListeners();
      }
    };

    const unsubscribe = wallet.subscribe((event) => {
      if (event.type === "walletStatusChanged") applyStatus(event.status);
    });

    const stop = () => {
      stopped = true;
      unsubscribe();
      removeInputListeners();
    };

    function handleFailure(error: unknown): void {
      if (stopped) return;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === WalletChannelDisconnectedError.code
      ) {
        stop();
      } else {
        console.error("[arx:ui] Failed to track wallet activity", error);
      }
    }

    void wallet.getStatus().then((initialStatus) => {
      // An event received after subscribing is newer than the initial read.
      if (status === undefined) applyStatus(initialStatus);
    }, handleFailure);

    return stop;
  }, [wallet]);
}
