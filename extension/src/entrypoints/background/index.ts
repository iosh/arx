import { createLogger } from "@arx/core/logger";
import { defineBackground } from "wxt/utils/define-background";
import { createBackgroundRoot } from "./backgroundRoot";

export default defineBackground(() => {
  const rootLog = createLogger("bg:root");
  const root = createBackgroundRoot();
  void root.initialize().catch((error) => {
    rootLog("failed to initialize background root", error);
  });
});
