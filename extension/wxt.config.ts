import { defineConfig } from "wxt";
export default defineConfig({
  manifestVersion: 3,
  srcDir: "src",
  imports: false,
  manifest: {
    web_accessible_resources: [
      {
        resources: ["inpage.js"],
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
