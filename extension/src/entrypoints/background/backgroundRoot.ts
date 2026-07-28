import { createCoreRuntime } from "@arx/core/runtime";
import { createDappTransportHost } from "@arx/provider/host";
import { createDexiePersistence } from "@arx/storage-dexie";
import { createWalletHost } from "@arx/wallet-api/host";
import type { Runtime } from "webextension-polyfill";
import browser from "webextension-polyfill";
import { createWalletUiInputSource } from "@/channels/walletUiInput";
import { acceptBrowserPort, type BrowserChannelHosts, type PendingBrowserPort } from "./browserChannels";

const EXTENSION_DATABASE_NAME = "arx-extension";

type BackgroundBrowser = Readonly<{
  runtime: Pick<typeof browser.runtime, "getURL" | "id" | "onConnect">;
}>;

export type BackgroundRootDependencies = Readonly<{
  browser: BackgroundBrowser;
  createPersistence: () => ReturnType<typeof createDexiePersistence>;
  createRuntime: typeof createCoreRuntime;
  createWalletHost: typeof createWalletHost;
  createDappTransportHost: typeof createDappTransportHost;
  createWalletUiInputSource: typeof createWalletUiInputSource;
  acceptBrowserPort: typeof acceptBrowserPort;
}>;

export type BackgroundRoot = Readonly<{
  initialize(): Promise<void>;
}>;

const productionDependencies: BackgroundRootDependencies = {
  browser,
  createPersistence: () => createDexiePersistence({ databaseName: EXTENSION_DATABASE_NAME }),
  createRuntime: createCoreRuntime,
  createWalletHost,
  createDappTransportHost,
  createWalletUiInputSource,
  acceptBrowserPort,
};

export const createBackgroundRoot = (
  dependencies: BackgroundRootDependencies = productionDependencies,
): BackgroundRoot => {
  const persistence = dependencies.createPersistence();
  const walletUiInput = dependencies.createWalletUiInputSource();
  const extensionUrl = dependencies.browser.runtime.getURL("");
  const runtimeId = dependencies.browser.runtime.id;
  let hostsPromise: Promise<BrowserChannelHosts> | null = null;
  let browserListenerAttached = false;

  const createHosts = async (): Promise<BrowserChannelHosts> => {
    const runtime = await dependencies.createRuntime({ persistence, userActivity: walletUiInput });

    return {
      wallet: dependencies.createWalletHost({ api: runtime.wallet }),
      dapp: dependencies.createDappTransportHost({ dappConnections: runtime.dappConnections }),
    };
  };

  const getHosts = (): Promise<BrowserChannelHosts> => {
    hostsPromise ??= createHosts();
    return hostsPromise;
  };

  const attachPendingPort = async (pendingPort: PendingBrowserPort) => {
    let hosts: BrowserChannelHosts;
    try {
      hosts = await getHosts();
    } catch {
      pendingPort.reject();
      return;
    }

    pendingPort.attach(hosts);
  };

  const onConnect = (port: Runtime.Port) => {
    const pendingPort = dependencies.acceptBrowserPort({
      port,
      extensionUrl,
      runtimeId,
      onWalletUiInput: walletUiInput.publish,
    });
    if (!pendingPort) {
      return;
    }

    void attachPendingPort(pendingPort);
  };

  const initialize = async () => {
    if (!browserListenerAttached) {
      dependencies.browser.runtime.onConnect.addListener(onConnect);
      browserListenerAttached = true;
    }

    await getHosts();
  };

  return { initialize };
};
