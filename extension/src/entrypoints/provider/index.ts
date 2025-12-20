import { InpageTransport } from "@arx/extension-provider/inpage";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { asWindowWithHost, ProviderHost } from "./providerHost";

const getProviderHost = () => {
  const globalWindow = asWindowWithHost(window);
  if (globalWindow.__ARX_PROVIDER_HOST__) {
    return globalWindow.__ARX_PROVIDER_HOST__;
  }

  const transport = new InpageTransport();
  const host = new ProviderHost(transport);

  Object.defineProperty(globalWindow, "__ARX_PROVIDER_HOST__", {
    configurable: true,
    enumerable: false,
    value: host,
  });

  return host;
};

export default defineUnlistedScript(() => {
  const host = getProviderHost();
  host.initialize();
});
