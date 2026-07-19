import type { JsonRpcHttpTransport } from "../../chainJsonRpc/JsonRpcHttpTransport.js";
import type { ChainRef } from "../../networks/chainRef.js";
import type { NetworksNamespaceAdapter } from "../../networks/namespaceAdapter.js";
import * as Hex from "../../utils/hex.js";
import { chainRefFromChainId } from "./chainId.js";
import { EIP155_BUILTIN_NETWORK_SEEDS } from "./chains.js";
import { EIP155_NAMESPACE } from "./constants.js";

const EIP155_DEFAULT_CHAIN_REF = "eip155:1" satisfies ChainRef;

export const createEip155NetworksAdapter = (options: {
  transport: JsonRpcHttpTransport;
}): NetworksNamespaceAdapter => ({
  namespace: EIP155_NAMESPACE,
  builtinNetworks: EIP155_BUILTIN_NETWORK_SEEDS,
  defaultChainRef: EIP155_DEFAULT_CHAIN_REF,
  queryChainRef: async (endpoint) => {
    const chainId = await options.transport.request<Hex.Hex>({
      endpoint,
      method: "eth_chainId",
    });
    return chainRefFromChainId(Hex.toBigInt(chainId));
  },
});
