import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: "src",
  imports: false,
  manifest: {
    web_accessible_resources: [
      {
        resources: ["provider.js"],
        matches: ["<all_urls>"],
      },
    ],
  },
});
