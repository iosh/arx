import { defineContentScript } from "wxt/utils/define-content-script";
import { injectScript } from "wxt/utils/inject-script";
import { bootstrapContent } from "./bootstrapContent";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_start",
  async main() {
    bootstrapContent();

    await injectScript("/provider.js", {
      keepInDom: true,
    });
  },
});
