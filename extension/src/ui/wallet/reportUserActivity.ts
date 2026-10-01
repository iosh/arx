import type { Runtime } from "webextension-polyfill";
import { WALLET_UI_INPUT_MESSAGE } from "@/transport/walletUiInput";

const INPUT_SIGNAL_INTERVAL_MS = 10_000;
const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;
const INPUT_LISTENER_OPTIONS = { capture: true, passive: true } as const;

export function reportUserActivity(port: Runtime.Port, inputTarget: EventTarget = window): () => void {
  let lastInputSignalAt: number | null = null;
  let stopped = false;

  const reportInput = (event: Event) => {
    if (!event.isTrusted) {
      return;
    }

    const now = Date.now();
    if (lastInputSignalAt !== null && now >= lastInputSignalAt && now - lastInputSignalAt < INPUT_SIGNAL_INTERVAL_MS) {
      return;
    }

    lastInputSignalAt = now;
    try {
      port.postMessage(WALLET_UI_INPUT_MESSAGE);
    } catch {
      stopInputReporting();
    }
  };

  const stopInputReporting = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    port.onDisconnect.removeListener(stopInputReporting);
    for (const event of INPUT_EVENTS) {
      inputTarget.removeEventListener(event, reportInput, INPUT_LISTENER_OPTIONS);
    }
  };

  for (const event of INPUT_EVENTS) {
    inputTarget.addEventListener(event, reportInput, INPUT_LISTENER_OPTIONS);
  }
  port.onDisconnect.addListener(stopInputReporting);

  return stopInputReporting;
}
