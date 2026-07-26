import type { DappConnectionsApi } from "../dappConnections/DappConnectionsApi.js";
import type { CorePersistence } from "../persistence/corePersistence.js";
import type { WalletApi } from "../wallet/WalletApi.js";

export type UserActivitySource = Readonly<{
  subscribe(listener: () => void): () => void;
}>;

export type CreateCoreRuntimeInput = Readonly<{
  persistence: CorePersistence;
  userActivity: UserActivitySource;
}>;

export type CoreRuntime = Readonly<{
  wallet: WalletApi;
  dappConnections: DappConnectionsApi;
}>;
