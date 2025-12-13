import browser from "webextension-polyfill";
import { defineBackground } from "wxt/utils/define-background";
import { createBackgroundApp } from "./app";

export default defineBackground(() => {
  const { start, stop } = createBackgroundApp();
  start();

  if (browser.runtime.onSuspend) {
    browser.runtime.onSuspend.addListener(stop);
  }
});
