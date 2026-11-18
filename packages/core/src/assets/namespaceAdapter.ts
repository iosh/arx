import type { Namespace } from "../namespaces/types.js";
import type { Network } from "../networks/types.js";
import type { AssetBalance } from "./types.js";

export type AssetsNamespaceAdapter = Readonly<{
  namespace: Namespace;
  getBalances(input: { network: Network; address: string }): Promise<readonly AssetBalance[]>;
}>;

export type AssetsNamespaceAdapters = Readonly<Record<Namespace, AssetsNamespaceAdapter | undefined>>;
