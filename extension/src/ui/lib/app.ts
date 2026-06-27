import { createInvokeClient, type InvokeConnectionStatus } from "@arx/core/invoke";
import {
  createWalletApiClient,
  WALLET_INVALIDATION_EVENT,
  WALLET_TARGET,
  type WalletInvalidationEvent,
} from "@arx/core/wallet";
import { createHostApiClient, HOST_ENTRY_CHANGED_EVENT, HOST_TARGET, type UiEntryLaunchContext } from "@/lib/host";
import { createUiPort } from "./uiPort";

const DEFAULT_RECONNECT = {
  getDelayMs: (attempt: number) => Math.min(5_000, 200 * 2 ** attempt),
} as const;

const sharedPort = createUiPort();
const invokeClient = createInvokeClient({
  channel: sharedPort,
  reconnect: DEFAULT_RECONNECT,
});

type AppTarget = typeof WALLET_TARGET | typeof HOST_TARGET;

const call = <TResult>(target: AppTarget, action: string, input?: unknown) => {
  return invokeClient.invoke<TResult>(target, action, input);
};

export const app = {
  wallet: createWalletApiClient((action, input) => call(WALLET_TARGET, action, input)),
  host: createHostApiClient((action, input) => call(HOST_TARGET, action, input)),
  walletEvents: {
    subscribeInvalidation(listener: (event: WalletInvalidationEvent) => void) {
      return invokeClient.subscribe((event) => {
        if (event.target !== WALLET_TARGET || event.name !== WALLET_INVALIDATION_EVENT) {
          return;
        }

        listener(event.payload as WalletInvalidationEvent);
      });
    },
  },
  hostEvents: {
    subscribeEntryChanged(listener: (entry: UiEntryLaunchContext) => void) {
      return invokeClient.subscribe((event) => {
        if (event.target !== HOST_TARGET || event.name !== HOST_ENTRY_CHANGED_EVENT) {
          return;
        }

        listener(event.payload as UiEntryLaunchContext);
      });
    },
  },
  onConnectionStatus(listener: (status: InvokeConnectionStatus) => void) {
    return invokeClient.onConnectionStatus(listener);
  },
} as const;
