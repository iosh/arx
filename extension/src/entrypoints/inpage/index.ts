import { bootstrapInpageProvider } from "@arx/provider/inpage";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { createInstalledProviderRegistry } from "@/platform/namespaces/installed";

export default defineUnlistedScript(() => {
  bootstrapInpageProvider({
    registry: createInstalledProviderRegistry(),
  });
});
