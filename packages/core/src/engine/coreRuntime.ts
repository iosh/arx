import type {
  ProviderRuntimeConnectionQuery,
  ProviderRuntimeConnectionState,
  ProviderRuntimeRequestScope,
  ProviderRuntimeRpcError,
  ProviderRuntimeRpcRequest,
  ProviderRuntimeRpcResponse,
  ProviderRuntimeSnapshot,
} from "../runtime/provider/types.js";
import type { UnlockLockedPayload, UnlockUnlockedPayload } from "../runtime/session/unlock/types.js";
import type { VaultMetaPort } from "../storage/index.js";
import type { UiMethodParams, UiMethodResult } from "../ui/protocol/index.js";
import type { UiSnapshot } from "../ui/protocol/schemas.js";
import type { ArxWalletStoragePorts, WalletNamespaceModule, WalletProviderConnectionProjection } from "./types.js";

export type CoreUnsubscribe = () => void;

export type CoreLogger = (message: string, error?: unknown) => void;

export type CoreRuntimeEnvironment = Readonly<{
  now?: () => number;
  createId?: () => string;
  logger?: CoreLogger;
}>;

export type CoreRuntimeBootOptions = Readonly<{
  hydrate?: boolean;
  recoverSubmittedTransactions?: boolean;
}>;

export type CoreStorageInput = Readonly<{
  ports: ArxWalletStoragePorts;
  vaultMetaPort?: VaultMetaPort;
}>;

export type CreateCoreRuntimeInput = Readonly<{
  namespaces: Readonly<{
    modules: readonly WalletNamespaceModule[];
  }>;
  storage: CoreStorageInput;
  environment?: CoreRuntimeEnvironment;
  boot?: CoreRuntimeBootOptions;
}>;

export type CoreProviderApi = Readonly<{
  buildSnapshot(namespace: string): ProviderRuntimeSnapshot;
  buildConnectionProjection(input: ProviderRuntimeConnectionQuery): WalletProviderConnectionProjection;
  executeRpcRequest(request: ProviderRuntimeRpcRequest): Promise<ProviderRuntimeRpcResponse>;
  encodeRuntimeRpcError(error: unknown): ProviderRuntimeRpcError;
  connect(input: { origin: string; namespace: string }): WalletProviderConnectionProjection;
  disconnect(input: { origin: string; namespace: string }): WalletProviderConnectionProjection;
  disconnectOrigin(origin: string): number;
  cancelRequestScope(input: ProviderRuntimeRequestScope): Promise<number>;
  subscribeSessionUnlocked(listener: (payload: UnlockUnlockedPayload) => void): CoreUnsubscribe;
  subscribeSessionLocked(listener: (payload: UnlockLockedPayload) => void): CoreUnsubscribe;
  subscribeNetworkStateChanged(listener: () => void): CoreUnsubscribe;
  subscribeNetworkSelectionChanged(listener: () => void): CoreUnsubscribe;
  subscribeAccountsStateChanged(listener: () => void): CoreUnsubscribe;
  subscribePermissionsStateChanged(listener: () => void): CoreUnsubscribe;
}>;

export type CoreSessionUnlockInput = UiMethodParams<"ui.session.unlock">;
export type CoreSessionLockInput = NonNullable<UiMethodParams<"ui.session.lock">>;
export type CoreSessionSetAutoLockDurationInput = UiMethodParams<"ui.session.setAutoLockDuration">;

export type CoreGenerateMnemonicInput = UiMethodParams<"ui.onboarding.generateMnemonic">;
export type CoreCreateWalletFromMnemonicInput = UiMethodParams<"ui.onboarding.createWalletFromMnemonic">;
export type CoreImportWalletFromMnemonicInput = UiMethodParams<"ui.onboarding.importWalletFromMnemonic">;
export type CoreImportWalletFromPrivateKeyInput = UiMethodParams<"ui.onboarding.importWalletFromPrivateKey">;

export type CoreSwitchActiveAccountInput = UiMethodParams<"ui.accounts.switchActive">;
export type CoreSelectWalletChainInput = UiMethodParams<"ui.networks.switchActive">;
export type CoreResolveApprovalInput = UiMethodParams<"ui.approvals.resolve">;

export type CoreConfirmNewMnemonicInput = UiMethodParams<"ui.keyrings.confirmNewMnemonic">;
export type CoreImportMnemonicInput = UiMethodParams<"ui.keyrings.importMnemonic">;
export type CoreImportPrivateKeyInput = UiMethodParams<"ui.keyrings.importPrivateKey">;
export type CoreDeriveAccountInput = UiMethodParams<"ui.keyrings.deriveAccount">;
export type CoreGetAccountsByKeyringInput = UiMethodParams<"ui.keyrings.getAccountsByKeyring">;
export type CoreRenameKeyringInput = UiMethodParams<"ui.keyrings.renameKeyring">;
export type CoreRenameAccountInput = UiMethodParams<"ui.keyrings.renameAccount">;
export type CoreMarkBackedUpInput = UiMethodParams<"ui.keyrings.markBackedUp">;
export type CoreHideHdAccountInput = UiMethodParams<"ui.keyrings.hideHdAccount">;
export type CoreUnhideHdAccountInput = UiMethodParams<"ui.keyrings.unhideHdAccount">;
export type CoreRemovePrivateKeyKeyringInput = UiMethodParams<"ui.keyrings.removePrivateKeyKeyring">;
export type CoreExportMnemonicInput = UiMethodParams<"ui.keyrings.exportMnemonic">;
export type CoreExportPrivateKeyInput = UiMethodParams<"ui.keyrings.exportPrivateKey">;

export type CoreRequestSendTransactionApprovalInput = UiMethodParams<"ui.transactions.requestSendTransactionApproval">;
export type CoreRerunTransactionPrepareInput = UiMethodParams<"ui.transactions.rerunPrepare">;
export type CoreApplyTransactionDraftEditInput = UiMethodParams<"ui.transactions.applyDraftEdit">;

export type CoreWalletUiApi = Readonly<{
  session: Readonly<{
    unlock(input: CoreSessionUnlockInput): Promise<UiMethodResult<"ui.session.unlock">>;
    lock(input?: CoreSessionLockInput): Promise<UiMethodResult<"ui.session.lock">>;
    resetAutoLockTimer(): Promise<UiMethodResult<"ui.session.resetAutoLockTimer">>;
    setAutoLockDuration(
      input: CoreSessionSetAutoLockDurationInput,
    ): Promise<UiMethodResult<"ui.session.setAutoLockDuration">>;
  }>;
  wallet: Readonly<{
    generateMnemonic(input?: CoreGenerateMnemonicInput): Promise<UiMethodResult<"ui.onboarding.generateMnemonic">>;
    createWalletFromMnemonic(
      input: CoreCreateWalletFromMnemonicInput,
    ): Promise<UiMethodResult<"ui.onboarding.createWalletFromMnemonic">>;
    importWalletFromMnemonic(
      input: CoreImportWalletFromMnemonicInput,
    ): Promise<UiMethodResult<"ui.onboarding.importWalletFromMnemonic">>;
    importWalletFromPrivateKey(
      input: CoreImportWalletFromPrivateKeyInput,
    ): Promise<UiMethodResult<"ui.onboarding.importWalletFromPrivateKey">>;
  }>;
  accounts: Readonly<{
    switchActive(input: CoreSwitchActiveAccountInput): Promise<UiMethodResult<"ui.accounts.switchActive">>;
  }>;
  chains: Readonly<{
    selectWalletChain(input: CoreSelectWalletChainInput): Promise<UiMethodResult<"ui.networks.switchActive">>;
  }>;
  approvals: Readonly<{
    resolve(input: CoreResolveApprovalInput): Promise<UiMethodResult<"ui.approvals.resolve">>;
  }>;
  keyrings: Readonly<{
    confirmNewMnemonic(input: CoreConfirmNewMnemonicInput): Promise<UiMethodResult<"ui.keyrings.confirmNewMnemonic">>;
    importMnemonic(input: CoreImportMnemonicInput): Promise<UiMethodResult<"ui.keyrings.importMnemonic">>;
    importPrivateKey(input: CoreImportPrivateKeyInput): Promise<UiMethodResult<"ui.keyrings.importPrivateKey">>;
    deriveAccount(input: CoreDeriveAccountInput): Promise<UiMethodResult<"ui.keyrings.deriveAccount">>;
    list(): Promise<UiMethodResult<"ui.keyrings.list">>;
    getAccountsByKeyring(
      input: CoreGetAccountsByKeyringInput,
    ): Promise<UiMethodResult<"ui.keyrings.getAccountsByKeyring">>;
    renameKeyring(input: CoreRenameKeyringInput): Promise<UiMethodResult<"ui.keyrings.renameKeyring">>;
    renameAccount(input: CoreRenameAccountInput): Promise<UiMethodResult<"ui.keyrings.renameAccount">>;
    markBackedUp(input: CoreMarkBackedUpInput): Promise<UiMethodResult<"ui.keyrings.markBackedUp">>;
    hideHdAccount(input: CoreHideHdAccountInput): Promise<UiMethodResult<"ui.keyrings.hideHdAccount">>;
    unhideHdAccount(input: CoreUnhideHdAccountInput): Promise<UiMethodResult<"ui.keyrings.unhideHdAccount">>;
    removePrivateKeyKeyring(
      input: CoreRemovePrivateKeyKeyringInput,
    ): Promise<UiMethodResult<"ui.keyrings.removePrivateKeyKeyring">>;
    exportMnemonic(input: CoreExportMnemonicInput): Promise<UiMethodResult<"ui.keyrings.exportMnemonic">>;
    exportPrivateKey(input: CoreExportPrivateKeyInput): Promise<UiMethodResult<"ui.keyrings.exportPrivateKey">>;
  }>;
  transactions: Readonly<{
    requestSendTransactionApproval(
      input: CoreRequestSendTransactionApprovalInput,
    ): Promise<UiMethodResult<"ui.transactions.requestSendTransactionApproval">>;
    rerunPrepare(input: CoreRerunTransactionPrepareInput): Promise<UiMethodResult<"ui.transactions.rerunPrepare">>;
    applyDraftEdit(
      input: CoreApplyTransactionDraftEditInput,
    ): Promise<UiMethodResult<"ui.transactions.applyDraftEdit">>;
  }>;
}>;

export type CoreReadChangeListener = () => void;

export type CoreReadApi = Readonly<{
  getWalletSnapshot(): UiSnapshot;
  getProviderSnapshot(namespace: string): ProviderRuntimeSnapshot;
  getProviderConnectionState(input: ProviderRuntimeConnectionQuery): ProviderRuntimeConnectionState;
  subscribe(listener: CoreReadChangeListener): CoreUnsubscribe;
}>;

export type CoreRuntime = Readonly<{
  provider: CoreProviderApi;
  ui: CoreWalletUiApi;
  read: CoreReadApi;
}>;

type AssertNever<T extends never> = T;
type CoreRuntimeInternalKey = "services" | "rpc" | "bus" | "lifecycle" | "shutdown";
type CoreWalletUiProtocolKey =
  | "dispatch"
  | "dispatchRequest"
  | "buildSnapshotEvent"
  | "getRequestBroadcastPolicy"
  | "subscribeUiEvents";

type _CoreRuntimeDoesNotExposeInternalKeys = AssertNever<Extract<keyof CoreRuntime, CoreRuntimeInternalKey>>;
type _CoreWalletUiDoesNotExposeProtocolKeys = AssertNever<Extract<keyof CoreWalletUiApi, CoreWalletUiProtocolKey>>;
