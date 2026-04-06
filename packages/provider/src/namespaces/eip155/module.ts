import { EIP155_NAMESPACE } from "@arx/core";
import type { ProviderDiscovery, ProviderModule } from "../../modules.js";
import { Eip155Provider, type Eip155ProviderTimeouts } from "./provider.js";
import type { ProviderPatch, ProviderSnapshot } from "./state.js";

export type Eip155ModuleOptions = {
  timeouts?: Eip155ProviderTimeouts;
  discovery?: Pick<ProviderDiscovery, "eip6963">;
};

export const createEip155Module = (
  options: Eip155ModuleOptions = {},
): ProviderModule<Eip155Provider, Eip155Provider, ProviderSnapshot, ProviderPatch> => {
  const discovery = options.discovery?.eip6963
    ? {
        eip6963: {
          info: { ...options.discovery.eip6963.info },
        },
      }
    : undefined;

  return {
    namespace: EIP155_NAMESPACE,
    create: ({ transport }) => {
      const provider = options.timeouts
        ? new Eip155Provider({ transport, timeouts: options.timeouts })
        : new Eip155Provider({ transport });
      return { core: provider, injected: provider };
    },
    injection: {
      windowKey: "ethereum",
      mode: "if_absent",
      initializedEvent: "ethereum#initialized",
    },
    ...(discovery ? { discovery } : {}),
  };
};
