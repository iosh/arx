import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
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
  vite: () => ({
    define: {
      process: { env: {} },
    },
  }),
});
