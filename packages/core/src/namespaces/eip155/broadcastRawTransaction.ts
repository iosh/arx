import type { Hex } from "ox/Hex";
import type { JsonRpcHttpTransport } from "../../chainJsonRpc/JsonRpcHttpTransport.js";
import type { ChainRef } from "../../networks/chainRef.js";
import type { NetworkRpcEndpointsReader } from "../../networks/types.js";

export type BroadcastEip155RawTransaction = (input: { chainRef: ChainRef; rawTransaction: Hex }) => Promise<Hex>;

export function createEip155RawTransactionBroadcaster({
  endpoints,
  transport,
}: {
  endpoints: NetworkRpcEndpointsReader;
  transport: JsonRpcHttpTransport;
}): BroadcastEip155RawTransaction {
  return async ({ chainRef, rawTransaction }) => {
    const [endpoint] = endpoints.getRpcEndpoints(chainRef);
    return transport.request<Hex>({
      endpoint,
      method: "eth_sendRawTransaction",
      params: [rawTransaction],
    });
  };
}
