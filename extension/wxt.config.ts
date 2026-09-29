import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";
export default defineConfig({
  manifestVersion: 3,
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
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
    plugins: [tailwindcss()],
    define: {
      process: { env: {} },
    },
  }),
});
