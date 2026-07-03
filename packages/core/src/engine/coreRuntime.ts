import type { NamespaceManifest } from "../namespaces/index.js";
import type {
  ProviderConnectionStateChangedHandler,
  ProviderRequestInput,
  ProviderRuntimeConnectionQuery,
  ProviderRuntimeConnectionState,
  ProviderRuntimeRequestScope,
  ProviderRuntimeRpcError,
  ProviderRuntimeRpcResponse,
} from "../runtime/provider/types.js";
import type { UnlockLockedPayload, UnlockUnlockedPayload } from "../runtime/session/unlock/types.js";
import type { WalletApi } from "../wallet/api.js";
import type { CoreStoragePorts, WalletProviderConnectionState } from "./types.js";

export type CoreUnsubscribe = () => void;

export type CoreRuntimeEnvironment = Readonly<{
  now?: () => number;
  createId?: () => string;
  logger?: (message: string, error?: unknown) => void;
}>;

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
  environment?: CoreRuntimeEnvironment;
  boot?: CoreRuntimeBootOptions;
}>;

export type CoreProviderApi = Readonly<{
  getConnectionState(input: ProviderRuntimeConnectionQuery): Promise<WalletProviderConnectionState>;
  activateConnectionScope(input: ProviderRuntimeConnectionQuery): Promise<ProviderRuntimeConnectionState>;
  deactivateConnectionScope(input: ProviderRuntimeConnectionQuery): void;
  subscribeConnectionStateChanged(listener: ProviderConnectionStateChangedHandler): CoreUnsubscribe;
  request(input: ProviderRequestInput): Promise<ProviderRuntimeRpcResponse>;
  encodeRuntimeRpcError(error: unknown): ProviderRuntimeRpcError;
  cancelRequestScope(input: ProviderRuntimeRequestScope): Promise<number>;
  subscribeSessionUnlocked(listener: (payload: UnlockUnlockedPayload) => void): CoreUnsubscribe;
  subscribeSessionLocked(listener: (payload: UnlockLockedPayload) => void): CoreUnsubscribe;
}>;

export type CoreRuntime = Readonly<{
  provider: CoreProviderApi;
  wallet: WalletApi;
}>;

type AssertNever<T extends never> = T;
type CoreRuntimeInternalKey = "services" | "rpc" | "messenger" | "lifecycle" | "shutdown";

type _CoreRuntimeDoesNotExposeInternalKeys = AssertNever<Extract<keyof CoreRuntime, CoreRuntimeInternalKey>>;
