import type { DappConnectionState, DappConnectionStateChanged } from "./DappConnections.js";
import type { DappConnectionScope } from "./persistence.js";

export type DappConnectionsApi = Readonly<{
  openConnection(scope: DappConnectionScope): DappConnectionState;
  getConnectionState(scope: DappConnectionScope): DappConnectionState;
  closeConnection(scope: DappConnectionScope): void;
  request(input: Readonly<{ scope: DappConnectionScope; method: string; params?: unknown }>): Promise<unknown>;
  subscribeStateChanged(listener: (change: DappConnectionStateChanged) => void): () => void;
}>;
