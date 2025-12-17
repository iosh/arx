import { bootstrapContent } from "@arx/provider-extension/content";
import { defineContentScript } from "wxt/utils/define-content-script";
import { injectScript } from "wxt/utils/inject-script";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: 'document_start',
  async main() {
    console.log("Injecting script...");
    await injectScript("/provider.js", {
      keepInDom: true,
    });

    await bootstrapContent();
  },
});
