import { createWalletClient, type WalletClient } from "@arx/wallet-api/client";
import browserDefault from "webextension-polyfill";
import { createPortChannel, waitForPortHost } from "@/transport/browserPort";
import { WALLET_UI_PORT_NAME } from "@/transport/portNames";
import { WALLET_UI_INPUT_MESSAGE } from "@/transport/walletUiInput";

const INPUT_SIGNAL_INTERVAL_MS = 10_000;
const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;
const INPUT_LISTENER_OPTIONS = { capture: true, passive: true } as const;

type TrustedUiBrowser = Pick<typeof browserDefault, "runtime">;

export type TrustedWalletConnection = Readonly<{
  wallet: WalletClient;
  stopInputReporting(): void;
}>;

export type ConnectTrustedWalletOptions = Readonly<{
  browser?: TrustedUiBrowser;
  inputTarget?: EventTarget;
}>;

export const connectTrustedWallet = async ({
  browser: browserApi = browserDefault,
  inputTarget = window,
}: ConnectTrustedWalletOptions = {}): Promise<TrustedWalletConnection> => {
  const port = browserApi.runtime.connect({ name: WALLET_UI_PORT_NAME });
  await waitForPortHost(port);
  const channel = createPortChannel(port);
  const wallet = createWalletClient({ channel });
  let lastInputSignalAt: number | null = null;
  let stopped = false;
  let unsubscribeDisconnect: () => void = () => undefined;

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
