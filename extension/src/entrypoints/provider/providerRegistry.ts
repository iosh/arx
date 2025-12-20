import { EthereumProvider } from "@arx/provider/provider";
import type { EIP1193Provider } from "@arx/provider/types";
import type { InpageTransport } from "@arx/extension-provider/inpage";
import { createEvmProxy } from "./evmProxy";

export const EIP155_NAMESPACE = "eip155" as const;

export type ProviderEntry = {
  raw: EIP1193Provider;
  proxy: EIP1193Provider;
  info: typeof EthereumProvider.providerInfo;
};

export type ProviderFactory = (opts: { transport: InpageTransport }) => ProviderEntry;

export type ProviderRegistry = {
  factories: Record<string, ProviderFactory>;
  injectionByNamespace: Record<string, { windowKey: string } | undefined>;
};

export const createProviderRegistry = (): ProviderRegistry => {
  const factories: Record<string, ProviderFactory> = {
    [EIP155_NAMESPACE]: ({ transport }) => {
      const raw = new EthereumProvider({ transport });
      const proxy = createEvmProxy(raw);
      return { raw, proxy, info: EthereumProvider.providerInfo };
    },
  };

  const injectionByNamespace: Record<string, { windowKey: string } | undefined> = {
    [EIP155_NAMESPACE]: { windowKey: "ethereum" },
  };

  return { factories, injectionByNamespace };
};
