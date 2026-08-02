import { createCoreRuntime, type UserActivitySource } from "@arx/core/runtime";
import { createDappTransportHost } from "@arx/provider/host";
import { createDexiePersistence } from "@arx/storage-dexie";
import { createWalletHost } from "@arx/wallet-api/host";
import browser from "webextension-polyfill";
import { defineBackground } from "wxt/utils/define-background";
import { createWalletUiInputSource } from "@/transport/walletUiInput";
import { handleBrowserConnection } from "./browserConnection";

const DATABASE_NAME = "arx-extension";

const createBackgroundHosts = async (userActivity: UserActivitySource) => {
  const persistence = createDexiePersistence({ databaseName: DATABASE_NAME });
  const runtime = await createCoreRuntime({ persistence, userActivity });

  return {
    wallet: createWalletHost({ api: runtime.wallet }),
    dapp: createDappTransportHost({ dappConnections: runtime.dappConnections }),
  };
};

export default defineBackground(() => {
  const walletUiInput = createWalletUiInputSource();
  const extensionUrl = browser.runtime.getURL("");
  const runtimeId = browser.runtime.id;
  const hosts = createBackgroundHosts(walletUiInput);

  browser.runtime.onConnect.addListener((connection) => {
    void handleBrowserConnection({
      connection,
      hosts,
      extensionUrl,
      runtimeId,
      onWalletUiInput: walletUiInput.publish,
    }).catch((error) => {
      console.error("[arx:bg]", "failed to attach browser connection", error);
    });
  });

  void hosts.catch((error) => {
    console.error("[arx:bg]", "failed to create background hosts", error);
  });
});
