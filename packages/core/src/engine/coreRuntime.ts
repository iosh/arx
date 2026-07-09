import type { NamespaceManifest } from "../namespaces/index.js";
import type {
  ProviderConnectionQuery,
  ProviderConnectionState,
  ProviderConnectionStateChangedHandler,
  ProviderRequestInput,
  ProviderRequestScope,
  ProviderRpcError,
  ProviderRpcResponse,
} from "../provider/access/types.js";
import type { UnlockLockedPayload, UnlockUnlockedPayload } from "../session/unlock/types.js";
import type { WalletApi } from "../wallet/api.js";
import type { CoreStoragePorts, WalletProviderConnectionState } from "./types.js";

export type CoreUnsubscribe = () => void;

export type CoreRuntimeBootOptions = Readonly<{
  hydrate?: boolean;
  transactionRestartRecovery?: "run" | "skip";
}>;

export type CoreStorageInput = CoreStoragePorts;

export type CreateCoreRuntimeInput = Readonly<{
  namespaces: Readonly<{
    manifests: readonly NamespaceManifest[];
  }>;
  storage: CoreStorageInput;
  boot?: CoreRuntimeBootOptions;
}>;

export type CoreProviderApi = Readonly<{
  getConnectionState(input: ProviderConnectionQuery): Promise<WalletProviderConnectionState>;
  activateConnectionScope(input: ProviderConnectionQuery): Promise<ProviderConnectionState>;
  deactivateConnectionScope(input: ProviderConnectionQuery): void;
  subscribeConnectionStateChanged(listener: ProviderConnectionStateChangedHandler): CoreUnsubscribe;
  request(input: ProviderRequestInput): Promise<ProviderRpcResponse>;
  encodeRpcError(error: unknown): ProviderRpcError;
  cancelRequestScope(input: ProviderRequestScope): Promise<number>;
  subscribeSessionUnlocked(listener: (payload: UnlockUnlockedPayload) => void): CoreUnsubscribe;
  subscribeSessionLocked(listener: (payload: UnlockLockedPayload) => void): CoreUnsubscribe;
}>;

export type CoreRuntime = Readonly<{
  provider: CoreProviderApi;
  wallet: WalletApi;
}>;

type AssertNever<T extends never> = T;
type CoreRuntimeInternalKey = "services" | "rpc" | "messenger" | "lifecycle";

type _CoreRuntimeDoesNotExposeInternalKeys = AssertNever<Extract<keyof CoreRuntime, CoreRuntimeInternalKey>>;
