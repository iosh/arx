import { createWalletClient, type WalletClient } from "@arx/wallet-api/client";
import browser, { type Runtime } from "webextension-polyfill";
import { createPortChannel, waitForPortHost } from "@/transport/browserPort";
import { WALLET_UI_PORT_NAME } from "@/transport/portNames";

export type WalletConnectionResult =
  | { status: "ready"; wallet: WalletClient; port: Runtime.Port }
  | { status: "error"; error: unknown };

export async function connectWallet(): Promise<WalletConnectionResult> {
  try {
    const port = browser.runtime.connect({ name: WALLET_UI_PORT_NAME });
    const wallet = createWalletClient({ channel: createPortChannel(port) });
    await waitForPortHost(port);
    return { status: "ready", wallet, port };
  } catch (error) {
    // Consume handshake failures even if React has not mounted yet.
    return { status: "error", error };
  }
}
