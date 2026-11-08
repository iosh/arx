import type { Hex } from "ox";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import type { ChainJsonRpcTarget } from "../../chainJsonRpc/types.js";

export type Eip155ChainIdOptions = ChainJsonRpcTarget;

export type Eip155Rpc = Readonly<{
  /** Queries a node. Dapp connection identity is returned separately by the dapp handler. */
  eth_chainId(params: readonly [], options: Eip155ChainIdOptions): Promise<Hex.Hex>;
}>;

export const createEip155Rpc = (chainJsonRpc: ChainJsonRpc): Eip155Rpc => ({
  eth_chainId: (params, options) =>
    chainJsonRpc.request<Hex.Hex>({
      ...options,
      method: "eth_chainId",
      params,
      replay: "allowed",
    }),
});
