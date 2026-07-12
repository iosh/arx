import { type CoreProviderApi, type CoreRuntime, createCoreRuntime } from "@arx/core/engine";
import { createMethodExecutor, type MethodExecutor, type MethodHandlerTree } from "@arx/core/invoke";
import type { ApprovalDetail, ApprovalListEntry, WalletApiAttentionSnapshot, WalletEvent } from "@arx/core/wallet";
import { INSTALLED_NAMESPACES } from "@/platform/namespaces/installed";
import { getExtensionStorage } from "@/platform/storage";
import { isInternalOrigin } from "./origin";

type BackgroundRuntimeCache = { core: CoreRuntime };

const createWalletHandlers = (wallet: CoreRuntime["wallet"]): MethodHandlerTree<CoreRuntime["wallet"]> => ({
  getStatus: () => wallet.getStatus(),
  getAutoLock: () => wallet.getAutoLock(),
  getSigner: (accountId) => wallet.getSigner(accountId),
  initializeWithNewMnemonic: (input) => wallet.initializeWithNewMnemonic(input),
  initializeFromMnemonic: (input) => wallet.initializeFromMnemonic(input),
  initializeFromPrivateKey: (input) => wallet.initializeFromPrivateKey(input),
  unlock: (password) => wallet.unlock(password),
  lock: () => wallet.lock(),
  changePassword: (input) => wallet.changePassword(input),
  setAutoLockDuration: (durationMs) => wallet.setAutoLockDuration(durationMs),
  accounts: {
    rename: (input) => wallet.accounts.rename(input),
    setHidden: (input) => wallet.accounts.setHidden(input),
    select: (accountId) => wallet.accounts.select(accountId),
    remove: (accountId) => wallet.accounts.remove(accountId),
  },
  keySources: {
    addMnemonic: (input) => wallet.keySources.addMnemonic(input),
    importMnemonic: (input) => wallet.keySources.importMnemonic(input),
    importPrivateKey: (input) => wallet.keySources.importPrivateKey(input),
    confirmBackup: (input) => wallet.keySources.confirmBackup(input),
    remove: (keySourceId) => wallet.keySources.remove(keySourceId),
  },
  keyrings: {
    add: (input) => wallet.keyrings.add(input),
    deriveAccount: (keyringId) => wallet.keyrings.deriveAccount(keyringId),
    remove: (keyringId) => wallet.keyrings.remove(keyringId),
  },
  delete: () => wallet.delete(),
  networks: {
    getChain: (chainRef) => wallet.networks.getChain(chainRef),
    listChains: () => wallet.networks.listChains(),
    getRpcEndpoints: (chainRef) => wallet.networks.getRpcEndpoints(chainRef),
    getWalletSelection: () => wallet.networks.getWalletSelection(),
    setCustomChain: (record) => wallet.networks.setCustomChain(record),
    removeCustomChain: (chainRef) => wallet.networks.removeCustomChain(chainRef),
    setRpcOverride: (input) => wallet.networks.setRpcOverride(input),
    clearRpcOverride: (chainRef) => wallet.networks.clearRpcOverride(chainRef),
    selectChainForWallet: (chainRef) => wallet.networks.selectChainForWallet(chainRef),
    selectNamespaceForWallet: (namespace) => wallet.networks.selectNamespaceForWallet(namespace),
    getProviderChainSelection: (input) => wallet.networks.getProviderChainSelection(input),
    initializeProviderChainSelection: (input) => wallet.networks.initializeProviderChainSelection(input),
    selectChainForProvider: (input) => wallet.networks.selectChainForProvider(input),
    clearProviderChainSelection: (input) => wallet.networks.clearProviderChainSelection(input),
    clearProviderChainSelections: (origin) => wallet.networks.clearProviderChainSelections(origin),
  },
  transactions: {
    get: (transactionId) => wallet.transactions.get(transactionId),
    list: (query) => wallet.transactions.list(query),
    submit: (input) => wallet.transactions.submit(input),
    createReplacementPayload: (input) => wallet.transactions.createReplacementPayload(input),
    monitor: {
      restore: (records) => wallet.transactions.monitor.restore(records),
      start: () => wallet.transactions.monitor.start(),
      stop: () => wallet.transactions.monitor.stop(),
      track: (record) => wallet.transactions.monitor.track(record),
      getNextInspectionAt: () => wallet.transactions.monitor.getNextInspectionAt(),
      runDue: (now) => wallet.transactions.monitor.runDue(now),
    },
  },
  approvals: {
    get: (approvalId) => wallet.approvals.get(approvalId),
    listPending: () => wallet.approvals.listPending(),
    resolve: (input) => wallet.approvals.resolve(input),
    cancel: (input) => wallet.approvals.cancel(input),
  },
});

export type BackgroundRuntimeHost = {
  initializeRuntime: () => Promise<void>;
  getCoreReady: () => Promise<CoreRuntime>;
  getOrInitProvider: () => Promise<CoreProviderApi>;
  getOrInitWalletMethodExecutor: () => Promise<MethodExecutor>;
  subscribeWalletEvents: (listener: (event: WalletEvent) => void) => Promise<() => void>;
  getOrInitUiEntryAccess: () => Promise<BackgroundUiEntryAccess>;
};

export type BackgroundUnlockAttentionRequestedPayload = WalletApiAttentionSnapshot["queue"][number] & {
  reason: "unlock_required";
};

export type BackgroundUiEntryAccess = {
  subscribeUnlockAttentionEvents: (listener: () => void) => () => void;
  listUnlockAttentionRequests: () => Promise<BackgroundUnlockAttentionRequestedPayload[]>;
  subscribeApprovalEvents: (listener: () => void) => () => void;
  dismissApproval: (params: { approvalId: string }) => Promise<void>;
  listPendingApprovals: () => Promise<ApprovalListEntry[]>;
  getApprovalDetail: (approvalId: string) => Promise<ApprovalDetail | null>;
  getSessionStatus: () => Promise<{ isUnlocked: boolean; hasInitializedVault: boolean }>;
};

export const createBackgroundRuntimeHost = (deps: { extensionOrigin: string }): BackgroundRuntimeHost => {
  let runtimeCache: BackgroundRuntimeCache | null = null;
  let runtimeCachePromise: Promise<BackgroundRuntimeCache> | null = null;
  let walletMethodExecutor: MethodExecutor | null = null;

  const getOrInitRuntimeCache = async (): Promise<BackgroundRuntimeCache> => {
    if (runtimeCache) return runtimeCache;
    if (runtimeCachePromise) return runtimeCachePromise;
    runtimeCachePromise = (async () => ({
      core: await createCoreRuntime({
        namespaces: INSTALLED_NAMESPACES.core,
        persistence: getExtensionStorage(),
        provider: {
          isInternalOrigin: (origin) => isInternalOrigin(origin, deps.extensionOrigin),
          shouldRequestUnlockAttention: () => true,
        },
      }),
    }))();
    try {
      runtimeCache = await runtimeCachePromise;
      return runtimeCache;
    } finally {
      runtimeCachePromise = null;
    }
  };

  return {
    initializeRuntime: async () => {
      await getOrInitRuntimeCache();
    },
    getCoreReady: async () => (await getOrInitRuntimeCache()).core,
    getOrInitProvider: async () => (await getOrInitRuntimeCache()).core.provider,
    getOrInitWalletMethodExecutor: async () => {
      if (walletMethodExecutor) return walletMethodExecutor;
      const { core } = await getOrInitRuntimeCache();
      walletMethodExecutor = createMethodExecutor<CoreRuntime["wallet"]>({
        handlers: createWalletHandlers(core.wallet),
      });
      return walletMethodExecutor;
    },
    subscribeWalletEvents: async (listener) => {
      const { core } = await getOrInitRuntimeCache();
      return core.subscribeChanged((event) => listener(event as unknown as WalletEvent));
    },
    getOrInitUiEntryAccess: async () => {
      const { core } = await getOrInitRuntimeCache();
      const subscribeOwner = (owner: string, listener: () => void) =>
        core.subscribeChanged((event) => {
          if (event.owner === owner) listener();
        });
      return {
        subscribeUnlockAttentionEvents: () => () => {},
        listUnlockAttentionRequests: async () => [],
        subscribeApprovalEvents: (listener) => subscribeOwner("approvals", listener),
        dismissApproval: async ({ approvalId }) => {
          core.wallet.approvals.cancel({ approvalId, reason: "user_dismissed" });
        },
        listPendingApprovals: async () => core.wallet.approvals.listPending() as unknown as ApprovalListEntry[],
        getApprovalDetail: async (approvalId) =>
          core.wallet.approvals.get(approvalId) as unknown as ApprovalDetail | null,
        getSessionStatus: async () => ({
          isUnlocked: core.wallet.getStatus() === "unlocked",
          hasInitializedVault: core.wallet.getStatus() !== "uninitialized",
        }),
      };
    },
  };
};
