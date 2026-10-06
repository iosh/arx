import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  imports: false,
  react: {
    vitePluginsBefore: [
      tanstackRouter({
        target: "react",
        quoteStyle: "double",
        semicolons: true,
      }),
    ],
  },
  manifest: ({ browser }) => ({
    // Vite and Tailwind target Chrome 111.
    ...(browser === "chrome" ? { minimum_chrome_version: "111" } : {}),
    permissions: ["storage"],
    web_accessible_resources: [
      {
        resources: ["inpage.js"],
        matches: ["<all_urls>"],
      },
    ],
  }),
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      process: { env: {} },
    },
  }),
});
