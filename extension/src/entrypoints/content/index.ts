import { defineContentScript } from "wxt/utils/define-content-script";
import { injectScript } from "wxt/utils/inject-script";
import { installProviderBridge } from "./providerBridge";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  async main() {
    installProviderBridge();

    await injectScript("/inpage.js", {
      keepInDom: true,
    });
  },
});
