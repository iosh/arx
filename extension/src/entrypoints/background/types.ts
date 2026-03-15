import type { RpcInvocationContext } from "@arx/core/rpc";
import type { ProviderRuntimeConnectionState, ProviderRuntimeSnapshot } from "@arx/core/runtime";

export type PortContext = {
  origin: string;
  providerNamespace: string | null;
  meta: ProviderBridgeSnapshot["meta"] | null;
  chainRef: string | null;
  chainId: string | null;
};

export type ProviderBridgeSnapshot = ProviderRuntimeSnapshot;
export type ProviderBridgeConnectionState = ProviderRuntimeConnectionState;

export type ArxRpcContext = {
  origin: string;
  arx?: (RpcInvocationContext & { meta: ProviderBridgeSnapshot["meta"] | null }) | undefined;
};
