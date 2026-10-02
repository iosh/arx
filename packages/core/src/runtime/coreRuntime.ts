import type { DappConnectionsApi } from "../dappConnections/DappConnectionsApi.js";
import type { CorePersistence } from "../persistence/corePersistence.js";
import type { WalletApi } from "../wallet/WalletApi.js";

export type CreateCoreRuntimeInput = Readonly<{
  persistence: CorePersistence;
}>;

export type CoreRuntime = Readonly<{
  wallet: WalletApi;
  dappConnections: DappConnectionsApi;
}>;
