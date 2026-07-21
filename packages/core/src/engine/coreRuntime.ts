import type { AccountsChanged } from "../accounts/types.js";
import type { ApprovalsApi, ApprovalsChanged } from "../approvals/types.js";
import type { ChainJsonRpcOptions } from "../chainJsonRpc/ChainJsonRpc.js";
import type { KeyringChanged } from "../keyring/types.js";
import type { NamespaceDefinition } from "../namespaces/definition.js";
import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "../networks/chainRef.js";
import type {
  CustomNetworkInput,
  NetworkSelectionChanged,
  NetworksChanged,
  NetworksReader,
  NonEmptyRpcEndpoints,
} from "../networks/types.js";
import type { PermissionsChanged } from "../permissions/Permissions.js";
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
  | Readonly<{ owner: "networks"; change: NetworksChanged | NetworkSelectionChanged }>
  | Readonly<{ owner: "transactions"; change: TransactionsChanged }>
  | Readonly<{ owner: "permissions"; change: PermissionsChanged }>
  | Readonly<{ owner: "approvals"; change: ApprovalsChanged }>;

export type CreateCoreRuntimeInput = Readonly<{
  namespaces: Readonly<{ definitions: readonly NamespaceDefinition[] }>;
  persistence: CorePersistence;
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
    networks: NetworksReader &
      Readonly<{
        addCustom(input: CustomNetworkInput): Promise<void>;
        updateCustom(input: CustomNetworkInput): Promise<void>;
        setRpcOverride(input: { chainRef: ChainRef; endpoints: NonEmptyRpcEndpoints }): Promise<void>;
        clearRpcOverride(chainRef: ChainRef): Promise<void>;
        selectNetwork(chainRef: ChainRef): Promise<void>;
        selectNamespace(namespace: Namespace): Promise<void>;
      }>;
    transactions: Transactions;
    approvals: ApprovalsApi;
  }>;

export type CoreRuntime = Readonly<{
  provider: CoreProviderApi;
  wallet: CoreWallet;
  subscribeChanged(listener: (event: CoreRuntimeChanged) => void): CoreUnsubscribe;
  close(): void;
}>;
