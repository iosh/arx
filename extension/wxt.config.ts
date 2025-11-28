import { tanstackRouter } from "@tanstack/router-plugin/vite";
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
    plugins: [
      {
        ...tanstackRouter({
          target: "react",
          autoCodeSplitting: true,
          routesDirectory: "./src/routes",
          generatedRouteTree: "./src/routeTree.gen.ts",
        }),
        enforce: "pre", // force to run before other plugins
      } as any,
    ],
  }),
});
