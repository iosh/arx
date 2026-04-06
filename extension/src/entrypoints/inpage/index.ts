import { bootstrapInpageProvider } from "@arx/provider/inpage";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { INSTALLED_NAMESPACES } from "@/platform/namespaces/installed";

export default defineUnlistedScript(() => {
  bootstrapInpageProvider({
    modules: INSTALLED_NAMESPACES.provider.modules,
    prewarmNamespaces: INSTALLED_NAMESPACES.provider.modules.some((module) => module.namespace === "eip155")
      ? ["eip155"]
      : [],
  });
});
