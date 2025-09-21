import { EthereumProvider } from "@arx/provider-core/provider";
import { InpageTransport } from "@arx/provider-extension/inpage";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

let singletonTransport: InpageTransport | undefined;
let singletonProvider: EthereumProvider | undefined;
let eip6963Registered = false;

export default defineUnlistedScript(async () => {
  if (!singletonProvider) {
    singletonTransport = new InpageTransport();
    await singletonTransport.connect();
    singletonProvider = new EthereumProvider({ transport: singletonTransport });

    if (!(window as any).ethereum) {
      Object.defineProperty(window, "ethereum", {
        value: singletonProvider,
        writable: false,
        configurable: false,
      });
    }
  }

  const provider = singletonProvider;

  const announce = () => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: EthereumProvider.providerInfo,
          provider,
        },
      }),
    );
  };

  if (!eip6963Registered) {
    window.addEventListener("eip6963:requestProvider", announce);
    eip6963Registered = true;
  }

  announce();
});
