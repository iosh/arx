import { bootstrapInpageProvider } from "@arx/provider/inpage";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { INSTALLED_NAMESPACES } from "@/platform/namespaces/installed";

export default defineUnlistedScript(() => {
  bootstrapInpageProvider({
    exposedNamespaces: INSTALLED_NAMESPACES.provider.exposedNamespaces,
    registry: INSTALLED_NAMESPACES.provider.registry,
  });
});
