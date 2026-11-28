import type { AssetsNamespaceAdapter } from "../../assets/namespaceAdapter.js";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import * as Hex from "../../utils/hex.js";
import { EIP155_NAMESPACE } from "./constants.js";

export const createEip155AssetsAdapter = (options: { chainJsonRpc: ChainJsonRpc }): AssetsNamespaceAdapter => ({
  namespace: EIP155_NAMESPACE,
  async getBalances({ network, address }) {
    const result = await options.chainJsonRpc.request({
      chainRef: network.chainRef,
      method: "eth_getBalance",
      params: [address, "latest"],
    });
    if (typeof result !== "string") throw new Hex.HexInvalidNumberError();

    return [
      {
        assetId: `${network.chainRef}/native`,
        ...network.nativeCurrency,
        balance: `${Hex.toBigInt(result)}`,
      },
    ];
  },
});
