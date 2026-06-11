import type { ChainRef } from "./ids.js";

export interface ChainIcon {
  url: string;
  width?: number | undefined;
  height?: number | undefined;
  format?: "svg" | "png" | "jpg" | "jpeg" | "webp" | undefined;
}

export interface ExplorerLink {
  type: string;
  url: string;
  title?: string | undefined;
}

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface ChainDefinition {
  chainRef: ChainRef;
  displayName: string;
  shortName?: string | undefined;
  nativeCurrency: NativeCurrency;
  blockExplorers?: readonly ExplorerLink[] | undefined;
  icon?: ChainIcon | undefined;
}

export type ChainDefinitionSeed<TRpcEndpoint = unknown> = {
  definition: ChainDefinition;
  defaultRpcEndpoints?: readonly TRpcEndpoint[] | undefined;
};

export const cloneChainDefinition = (definition: ChainDefinition): ChainDefinition => ({
  chainRef: definition.chainRef,
  displayName: definition.displayName,
  shortName: definition.shortName,
  nativeCurrency: {
    name: definition.nativeCurrency.name,
    symbol: definition.nativeCurrency.symbol,
    decimals: definition.nativeCurrency.decimals,
  },
  blockExplorers: definition.blockExplorers
    ? definition.blockExplorers.map((explorer) => ({
        type: explorer.type,
        url: explorer.url,
        title: explorer.title,
      }))
    : undefined,
  icon: definition.icon
    ? {
        url: definition.icon.url,
        width: definition.icon.width,
        height: definition.icon.height,
        format: definition.icon.format,
      }
    : undefined,
});
