import { defineBackground } from "wxt/utils/define-background";
import { createBackgroundRoot } from "./backgroundRoot";

const LOG_PREFIX = "[arx:bg:root]";

export default defineBackground(() => {
  const root = createBackgroundRoot();
  void root.initialize().catch((error) => {
    console.error(LOG_PREFIX, "failed to initialize background root", error);
  });
});
