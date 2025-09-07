import { EthereumProvider } from "@arx/provider-core/provider";
import { InpageTransport } from "@arx/provider-extension/inpage";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

export default defineUnlistedScript(async () => {
  const existing = (window as any).ethereum;
  if (existing) return;
  const transport = new InpageTransport();
  await transport.connect();

  const provider = new EthereumProvider({ transport });

  Object.defineProperty(window, "ethereum", {
    value: provider,
    writable: false,
    configurable: false,
  });
});
