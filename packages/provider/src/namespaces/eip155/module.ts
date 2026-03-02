import type { ProviderModule } from "../../registry/types.js";
import { EIP6963_PROVIDER_INFO } from "./constants.js";
import { createEip155InjectedProvider } from "./injected.js";
import type { Eip155ProviderTimeouts } from "./provider.js";
import { Eip155Provider } from "./provider.js";

export type Eip155ModuleOptions = {
  timeouts?: Eip155ProviderTimeouts;
};

export const createEip155Module = (options: Eip155ModuleOptions = {}): ProviderModule => {
  return {
    namespace: "eip155",
    create: ({ transport }) => {
      const raw = options.timeouts
        ? new Eip155Provider({ transport, timeouts: options.timeouts })
        : new Eip155Provider({ transport });
      const injected = createEip155InjectedProvider(raw);
      return { raw, injected, destroy: () => raw.destroy() };
    },
    injection: {
      windowKey: "ethereum",
      mode: "if_absent",
      initializedEvent: "ethereum#initialized",
    },
    discovery: {
      eip6963: { info: EIP6963_PROVIDER_INFO },
    },
  };
};
