import type { DappConnectionState, DappConnectionStateChanged } from "./DappConnections.js";

export type DappConnectionScopeInput = Readonly<{
  /** Supplied by the host's verified sender context. */
  origin: string;
  namespace: string;
}>;

export type DappConnectionsApi = Readonly<{
  /** Opens or reuses the namespace's connection state without granting account access. */
  openConnection(scope: DappConnectionScopeInput): DappConnectionState;
  getConnectionState(scope: DappConnectionScopeInput): DappConnectionState;
  closeConnection(scope: DappConnectionScopeInput): void;
  request(input: Readonly<{ scope: DappConnectionScopeInput; method: string; params?: unknown }>): Promise<unknown>;
  subscribeStateChanged(listener: (change: DappConnectionStateChanged) => void): () => void;
}>;
