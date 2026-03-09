import type { RpcInvocationContext } from "@arx/core";
import type { TransportMeta } from "@arx/provider/types";

export type PortContext = {
  origin: string;
  providerNamespace: string | null;
  meta: TransportMeta | null;
  chainRef: string | null;
  chainId: string | null;
};

export type ProviderBridgeSnapshot = {
  namespace: string;
  chain: { chainId: string; chainRef: string };
  isUnlocked: boolean;
  meta: TransportMeta;
};

export type ArxRpcContext = {
  origin: string;
  arx?: (RpcInvocationContext & { meta: TransportMeta | null }) | undefined;
};
