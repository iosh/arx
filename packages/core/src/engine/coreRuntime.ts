import type { AccountsChanged } from "../accounts/types.js";
import type { ApprovalQueueService } from "../approvals/queue/types.js";
import type { ChainJsonRpcOptions } from "../chainJsonRpc/ChainJsonRpc.js";
import type { Networks, NetworksChanged } from "../chains/networks.js";
import type { WalletChainSelectionDefaults } from "../chains/selection.js";
import type { KeyringChanged } from "../keyring/types.js";
import type { NamespaceDefinition } from "../namespaces/definition.js";
import type { CorePersistence } from "../persistence/corePersistence.js";
import type {
  ProviderConnectionQuery,
  ProviderConnectionState,
  ProviderConnectionStateChangedHandler,
  ProviderRequestInput,
  ProviderRequestScope,
  ProviderRpcError,
  ProviderRpcResponse,
} from "../provider/access/types.js";
import type { Transactions, TransactionsChanged } from "../transactions/Transactions.js";
import type { Wallet, WalletStatusChanged } from "../wallet/Wallet.js";

export type CoreUnsubscribe = () => void;

export type CoreRuntimeChanged =
  | Readonly<{ owner: "wallet"; change: WalletStatusChanged }>
  | Readonly<{ owner: "keyring"; change: KeyringChanged }>
  | Readonly<{ owner: "accounts"; change: AccountsChanged }>
  | Readonly<{ owner: "networks"; change: NetworksChanged }>
  | Readonly<{ owner: "transactions"; change: TransactionsChanged }>
  | Readonly<{ owner: "permissions" }>
  | Readonly<{ owner: "approvals" }>;

export type CreateCoreRuntimeInput = Readonly<{
  namespaces: Readonly<{ definitions: readonly NamespaceDefinition[] }>;
  persistence: CorePersistence;
  defaults?: Readonly<{
    walletSelection?: WalletChainSelectionDefaults;
  }>;
  rpc?: Readonly<{
    options?: Partial<Omit<ChainJsonRpcOptions, "endpoints">>;
  }>;
  provider?: Readonly<{
    isInternalOrigin(origin: string): boolean;
    shouldRequestUnlockAttention?(input: {
      origin: string;
      method: string;
      chainRef: string | null;
      namespace: string | null;
    }): boolean;
  }>;
}>;

export type CoreProviderConnectionState = ProviderConnectionState & Readonly<{ connected: boolean }>;

export type CoreProviderApi = Readonly<{
  getConnectionState(input: ProviderConnectionQuery): Promise<CoreProviderConnectionState>;
  activateConnectionScope(input: ProviderConnectionQuery): Promise<CoreProviderConnectionState>;
  deactivateConnectionScope(input: ProviderConnectionQuery): void;
  subscribeConnectionStateChanged(listener: ProviderConnectionStateChangedHandler): CoreUnsubscribe;
  subscribeSessionUnlocked(listener: (payload: { at: number }) => void): CoreUnsubscribe;
  subscribeSessionLocked(listener: (payload: { at: number; reason: "manual" }) => void): CoreUnsubscribe;
  request(input: ProviderRequestInput): Promise<ProviderRpcResponse>;
  encodeRpcError(error: unknown): ProviderRpcError;
  cancelRequestScope(input: ProviderRequestScope): Promise<number>;
}>;

export type CoreWallet = Wallet &
  Readonly<{
    networks: Networks;
    transactions: Transactions;
    approvals: Pick<ApprovalQueueService, "get" | "listPending" | "resolve" | "cancel">;
  }>;

export type CoreRuntime = Readonly<{
  provider: CoreProviderApi;
  wallet: CoreWallet;
  subscribeChanged(listener: (event: CoreRuntimeChanged) => void): CoreUnsubscribe;
  close(): void;
}>;
