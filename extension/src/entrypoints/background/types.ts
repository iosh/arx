import type { ProviderConnectionState, ProviderSnapshot } from "@arx/core/provider";

export type ConnectedPortContext = {
  origin: string;
};

export type ProviderSessionContext = ConnectedPortContext & {
  namespace: string;
};

export type PortContext = ConnectedPortContext | ProviderSessionContext;

export type ProviderBridgeSnapshot = ProviderSnapshot;
export type ProviderBridgeConnectionState = ProviderConnectionState;
