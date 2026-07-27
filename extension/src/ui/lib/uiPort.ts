import type { DuplexChannel } from "@arx/message-channel";
import browser from "webextension-polyfill";
import { createRuntimePortChannel } from "@/platform/browser/runtimePortChannel";
import { WALLET_UI_PORT_NAME } from "@/platform/browser/runtimePortNames";

type WalletUiBrowser = Pick<typeof browser, "runtime">;

export type CreateWalletUiChannelOptions = Readonly<{
  browser?: WalletUiBrowser;
}>;

export const createWalletUiChannel = ({
  browser: browserApi = browser,
}: CreateWalletUiChannelOptions = {}): DuplexChannel => {
  return createRuntimePortChannel(browserApi.runtime.connect({ name: WALLET_UI_PORT_NAME }));
};
