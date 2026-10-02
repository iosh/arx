import { createCoreRuntime } from "@arx/core/runtime";
import { createDappTransportHost } from "@arx/provider/host";
import { createDexiePersistence } from "@arx/storage-dexie";
import { createWalletHost } from "@arx/wallet-api/host";
import browser from "webextension-polyfill";
import { defineBackground } from "wxt/utils/define-background";
import { startBackgroundHeartbeat } from "./backgroundHeartbeat";
import { handleBrowserConnection } from "./browserConnection";

const DATABASE_NAME = "arx-extension";

const createBackgroundHosts = async () => {
  const persistence = createDexiePersistence({ databaseName: DATABASE_NAME });
  const runtime = await createCoreRuntime({ persistence });

  return {
    wallet: createWalletHost({ api: runtime.wallet }),
    dapp: createDappTransportHost({ dappConnections: runtime.dappConnections }),
  };
};

export default defineBackground(() => {
  const extensionUrl = browser.runtime.getURL("");
  const runtimeId = browser.runtime.id;
  const stopHeartbeat = startBackgroundHeartbeat();
  let hosts: ReturnType<typeof createBackgroundHosts> | undefined;
  const initialize = () => (hosts ??= createBackgroundHosts());

  browser.runtime.onStartup.addListener(() => {
    void initialize();
  });

  browser.runtime.onConnect.addListener((connection) => {
    void handleBrowserConnection({
      connection,
      hosts: initialize(),
      extensionUrl,
      runtimeId,
    }).catch((error) => {
      console.error("[arx:bg]", "failed to attach browser connection", error);
    });
  });

  void initialize().catch((error) => {
    stopHeartbeat();
    console.error("[arx:bg]", "failed to create background hosts", error);
  });
});
