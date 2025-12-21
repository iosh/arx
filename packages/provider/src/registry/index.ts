import { createEip155InjectedProvider } from "../namespaces/eip155/injected.js";
import { Eip155Provider } from "../provider/index.js";
import type { EIP1193Provider, Transport } from "../types/index.js";

export const EIP155_NAMESPACE = "eip155" as const;

export type ProviderEntry = {
  raw: EIP1193Provider;
  proxy: EIP1193Provider;
  info: typeof Eip155Provider.providerInfo;
};

export type ProviderFactory = (opts: { transport: Transport }) => ProviderEntry;

export type ProviderRegistry = {
  factories: Record<string, ProviderFactory>;
  injectionByNamespace: Record<string, { windowKey: string } | undefined>;
};

export type ProviderRegistryOptions = {
  ethereum?: {
    timeouts?: import("../namespaces/eip155/provider.js").Eip155ProviderTimeouts;
  };
};

export const createProviderRegistry = (options: ProviderRegistryOptions = {}): ProviderRegistry => {
  const factories: Record<string, ProviderFactory> = {
    [EIP155_NAMESPACE]: ({ transport }) => {
      const timeouts = options.ethereum?.timeouts;
      const raw = timeouts ? new Eip155Provider({ transport, timeouts }) : new Eip155Provider({ transport });
      const proxy = createEip155InjectedProvider(raw);
      return { raw, proxy, info: Eip155Provider.providerInfo };
    },
  };

  const injectionByNamespace: Record<string, { windowKey: string } | undefined> = {
    [EIP155_NAMESPACE]: { windowKey: "ethereum" },
  };

  return { factories, injectionByNamespace };
};
