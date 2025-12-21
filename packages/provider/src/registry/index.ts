import { createEvmProxy } from "../evm/index.js";
import { EthereumProvider } from "../provider/index.js";
import type { EIP1193Provider, Transport } from "../types/index.js";

export const EIP155_NAMESPACE = "eip155" as const;

export type ProviderEntry = {
  raw: EIP1193Provider;
  proxy: EIP1193Provider;
  info: typeof EthereumProvider.providerInfo;
};

export type ProviderFactory = (opts: { transport: Transport }) => ProviderEntry;

export type ProviderRegistry = {
  factories: Record<string, ProviderFactory>;
  injectionByNamespace: Record<string, { windowKey: string } | undefined>;
};

export type ProviderRegistryOptions = {
  ethereum?: {
    timeouts?: import("../provider/ethereumProvider.js").EthereumProviderTimeouts;
  };
};

export const createProviderRegistry = (options: ProviderRegistryOptions = {}): ProviderRegistry => {
  const factories: Record<string, ProviderFactory> = {
    [EIP155_NAMESPACE]: ({ transport }) => {
      const timeouts = options.ethereum?.timeouts;
      const raw = timeouts ? new EthereumProvider({ transport, timeouts }) : new EthereumProvider({ transport });
      const proxy = createEvmProxy(raw);
      return { raw, proxy, info: EthereumProvider.providerInfo };
    },
  };

  const injectionByNamespace: Record<string, { windowKey: string } | undefined> = {
    [EIP155_NAMESPACE]: { windowKey: "ethereum" },
  };

  return { factories, injectionByNamespace };
};
