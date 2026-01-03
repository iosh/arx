import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = fileURLToPath(new URL(".", import.meta.url));
const srcDir = resolve(here, "src");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${srcDir}/` },
      { find: /^~\//, replacement: `${srcDir}/` },

      { find: /^@@\//, replacement: `${resolve(here)}/` },
      { find: /^~~\//, replacement: `${resolve(here)}/` },
    ],
  },
  test: {
    environment: "node",
  },
});
