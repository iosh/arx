import { InpageTransport } from "@arx/provider-extension/inpage";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { asWindowWithHost, ProviderHost } from "./providerHost";

const ensureProviderHost = () => {
  const globalWindow = asWindowWithHost(window);
  if (globalWindow.__ARX_PROVIDER_HOST__) {
    return globalWindow.__ARX_PROVIDER_HOST__;
  }
  const transport = new InpageTransport();
  const host = new ProviderHost(transport);
  globalWindow.__ARX_PROVIDER_HOST__ = host;
  return host;
};

export default defineUnlistedScript(async () => {
  const host = ensureProviderHost();
  await host.start();
});
