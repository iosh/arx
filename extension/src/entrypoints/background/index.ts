import { createLogger } from "@arx/core/logger";
import browser from "webextension-polyfill";
import { defineBackground } from "wxt/utils/define-background";
import { createBackgroundRoot } from "./backgroundRoot";

export default defineBackground(() => {
  const rootLog = createLogger("bg:root");
  const root = createBackgroundRoot();
  void root.initialize().catch((error) => {
    rootLog("failed to initialize background root", error);
  });

  if (browser.runtime.onSuspend) {
    browser.runtime.onSuspend.addListener(() => {
      void root.shutdown().catch((error) => {
        rootLog("failed to shutdown background root", error);
      });
    });
  }
});
