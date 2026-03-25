import type {
  ProviderRuntimeConnectionState,
  ProviderRuntimeRpcContext,
  ProviderRuntimeSnapshot,
} from "@arx/core/runtime";

export type PortContext = {
  origin: string;
  providerNamespace: string | null;
  chainRef: string | null;
};

export type ProviderBridgeSnapshot = ProviderRuntimeSnapshot;
export type ProviderBridgeConnectionState = ProviderRuntimeConnectionState;
export type ProviderBridgeRpcContext = ProviderRuntimeRpcContext;
