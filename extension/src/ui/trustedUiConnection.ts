import { createWalletClient, type WalletClient } from "@arx/wallet-api/client";
import browserDefault from "webextension-polyfill";
import { createRuntimePortChannel } from "@/platform/browser/runtimePortChannel";
import { WALLET_UI_PORT_NAME } from "@/platform/browser/runtimePortNames";
import { WALLET_UI_INPUT_MESSAGE } from "@/platform/browser/walletUiInput";

const INPUT_SIGNAL_INTERVAL_MS = 10_000;
const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;
const INPUT_LISTENER_OPTIONS = { capture: true, passive: true } as const;

type TrustedUiBrowser = Pick<typeof browserDefault, "runtime">;

export type TrustedUiConnection = Readonly<{
  wallet: WalletClient;
  stopInputReporting(): void;
}>;

export type CreateTrustedUiConnectionOptions = Readonly<{
  browser?: TrustedUiBrowser;
  inputTarget?: EventTarget;
}>;

export const createTrustedUiConnection = ({
  browser: browserApi = browserDefault,
  inputTarget = window,
}: CreateTrustedUiConnectionOptions = {}): TrustedUiConnection => {
  const port = browserApi.runtime.connect({ name: WALLET_UI_PORT_NAME });
  const channel = createRuntimePortChannel(port);
  const wallet = createWalletClient({ channel });
  let lastInputSignalAt: number | null = null;
  let stopped = false;
  let unsubscribeDisconnect: () => void = () => undefined;

  const reportInput = () => {
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
    unsubscribeDisconnect();
    for (const event of INPUT_EVENTS) {
      inputTarget.removeEventListener(event, reportInput, INPUT_LISTENER_OPTIONS);
    }
  };

  for (const event of INPUT_EVENTS) {
    inputTarget.addEventListener(event, reportInput, INPUT_LISTENER_OPTIONS);
  }
  unsubscribeDisconnect = channel.onDisconnect(stopInputReporting);

  return { wallet, stopInputReporting };
};
