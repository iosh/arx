import type {
  ProviderRuntimeConnectionState,
  ProviderRuntimeRpcContext,
  ProviderRuntimeSnapshot,
} from "@arx/core/runtime";

export type ConnectedPortContext = {
  origin: string;
};

export type ProviderSessionContext = ConnectedPortContext & {
  providerNamespace: string;
};

export type PortContext = ConnectedPortContext | ProviderSessionContext;

export type ProviderBridgeSnapshot = ProviderRuntimeSnapshot;
export type ProviderBridgeConnectionState = ProviderRuntimeConnectionState;
export type ProviderBridgeRpcContext = ProviderRuntimeRpcContext;
