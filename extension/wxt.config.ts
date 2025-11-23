import { defineConfig } from "wxt";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
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
    plugins: [
      {
        ...tanstackRouter({
          target: "react",
          autoCodeSplitting: true,
          routesDirectory: "./src/routes",
          generatedRouteTree: "./src/routeTree.gen.ts",
        }),
        enforce: "pre", // 关键：强制在 pre 阶段执行
      } as any,
    ],
  }),
});
