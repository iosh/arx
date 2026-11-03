import type { JsonRpcHttpTransport } from "../../chainJsonRpc/JsonRpcHttpTransport.js";
import type { NetworksNamespaceAdapter } from "../../networks/namespaceAdapter.js";
import * as Hex from "../../utils/hex.js";
import { chainRefFromChainId } from "./chainId.js";
import { EIP155_BUILTIN_NETWORK_SEEDS } from "./chains.js";
import { EIP155_NAMESPACE } from "./constants.js";

export const createEip155NetworksAdapter = (options: {
  transport: JsonRpcHttpTransport;
}): NetworksNamespaceAdapter => ({
  namespace: EIP155_NAMESPACE,
  builtinNetworks: EIP155_BUILTIN_NETWORK_SEEDS,
  queryChainRef: async (endpoint) => {
    const chainId = await options.transport.request<Hex.Hex>({
      endpoint,
      method: "eth_chainId",
    });
    return chainRefFromChainId(Hex.toBigInt(chainId));
  },
});
