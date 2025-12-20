import { InpageTransport } from "@arx/extension-provider/inpage";
import { createProviderHost, type ProviderHost, type ProviderHostWindow } from "@arx/provider/host";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

type WindowWithArxHost = Window & { __ARX_PROVIDER_HOST__?: ProviderHost };
const asWindowWithHost = (target: Window): WindowWithArxHost => target as WindowWithArxHost;

const getProviderHost = () => {
  const globalWindow = asWindowWithHost(window);
  if (globalWindow.__ARX_PROVIDER_HOST__) return globalWindow.__ARX_PROVIDER_HOST__;

  const transport = new InpageTransport();
  const targetWindow = window as unknown as ProviderHostWindow;
  const host = createProviderHost({ targetWindow, transport });

  Object.defineProperty(globalWindow, "__ARX_PROVIDER_HOST__", {
    configurable: true,
    enumerable: false,
    value: host,
  });

  return host;
};

export default defineUnlistedScript(() => {
  getProviderHost().initialize();
});
