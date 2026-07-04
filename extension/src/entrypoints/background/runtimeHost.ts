import {
  type CoreProviderApi,
  type CoreRuntime,
  createArxWalletRuntime,
  createCoreRuntimeFromArxWalletRuntime,
} from "@arx/core/engine";
import type { MethodExecutor } from "@arx/core/invoke";
import {
  type ApprovalDetail,
  type ApprovalListEntry,
  WALLET_UI_CALLER_ORIGIN,
  type WalletApiAttentionSnapshot,
  type WalletEvent,
} from "@arx/core/wallet";
import { INSTALLED_NAMESPACES } from "@/platform/namespaces/installed";
import { getExtensionStorage } from "@/platform/storage";
import { isInternalOrigin } from "./origin";

type BackgroundRuntimeCache = {
  core: CoreRuntime;
  runtime: Awaited<ReturnType<typeof createArxWalletRuntime>>;
};

export type BackgroundRuntimeHost = {
  initializeRuntime: () => Promise<void>;
  getCoreReady: () => Promise<CoreRuntime>;
  getOrInitProvider: () => Promise<CoreProviderApi>;
  getOrInitWalletMethodExecutor: () => Promise<MethodExecutor>;
  subscribeWalletEvents: (listener: (event: WalletEvent) => void) => Promise<() => void>;
  getOrInitUiEntryAccess: () => Promise<BackgroundUiEntryAccess>;
  shutdown: () => Promise<void>;
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
  getSessionStatus: () => Promise<Awaited<ReturnType<CoreRuntime["wallet"]["session"]["getStatus"]>>>;
};

export const createBackgroundRuntimeHost = (deps: { extensionOrigin: string }): BackgroundRuntimeHost => {
  let runtimeCache: BackgroundRuntimeCache | null = null;
  let runtimeCachePromise: Promise<BackgroundRuntimeCache> | null = null;
  let provider: CoreProviderApi | null = null;
  let walletMethodExecutor: MethodExecutor | null = null;
  let runtimeGeneration = 0;

  const initializeRuntime = async () => {
    await getOrInitRuntimeCache();
  };

  const getOrInitRuntimeCache = async (): Promise<BackgroundRuntimeCache> => {
    if (runtimeCache) return runtimeCache;
    if (runtimeCachePromise) return runtimeCachePromise;

    const bootGeneration = runtimeGeneration;

    runtimeCachePromise = (async () => {
      const storage = getExtensionStorage();
      const runtime = await createArxWalletRuntime({
        namespaces: INSTALLED_NAMESPACES.core,
        storage: {
          ports: storage.ports,
        },
        runtime: {
          lifecycleLabel: "createBackgroundRuntimeHost",
          rpcAccessPolicy: {
            isInternalOrigin: (origin) => isInternalOrigin(origin, deps.extensionOrigin),
            shouldRequestUnlockAttention: () => true,
          },
        },
      });

      if (bootGeneration !== runtimeGeneration) {
        await runtime.shutdown();
        throw new Error("Background runtime host was reset during boot");
      }

      const core = createCoreRuntimeFromArxWalletRuntime(runtime);
      const next: BackgroundRuntimeCache = { core, runtime };

      runtimeCache = next;
      return next;
    })();

    try {
      return await runtimeCachePromise;
    } finally {
      runtimeCachePromise = null;
    }
  };

  const getCoreReady = async (): Promise<CoreRuntime> => {
    const active = await getOrInitRuntimeCache();
    return active.core;
  };

  const getOrInitWalletMethodExecutor = async (): Promise<MethodExecutor> => {
    if (walletMethodExecutor) {
      return walletMethodExecutor;
    }
    const active = await getOrInitRuntimeCache();
    walletMethodExecutor = active.runtime.createWalletMethodExecutor({
      origin: WALLET_UI_CALLER_ORIGIN,
    });
    return walletMethodExecutor;
  };

  const subscribeWalletEvents = async (listener: (event: WalletEvent) => void) => {
    const active = await getOrInitRuntimeCache();
    return active.runtime.subscribeWalletEvents(listener);
  };

  const getOrInitProvider = async (): Promise<CoreProviderApi> => {
    if (provider) {
      return provider;
    }

    const providerGeneration = runtimeGeneration;
    const active = await getOrInitRuntimeCache();
    if (providerGeneration !== runtimeGeneration) {
      throw new Error("Background runtime host was reset during provider bootstrap");
    }

    provider = active.core.provider;
    return provider;
  };

  const getOrInitUiEntryAccess = async (): Promise<BackgroundUiEntryAccess> => {
    const active = await getOrInitRuntimeCache();
    const subscribeApprovalEvents = (listener: () => void) =>
      active.runtime.subscribeWalletEvents((event) => {
        if (event.topic !== "approvals") {
          return;
        }

        listener();
      });
    const subscribeUnlockAttentionEvents = (listener: () => void) =>
      active.runtime.subscribeWalletEvents((event) => {
        if (event.topic !== "attention") {
          return;
        }

        listener();
      });
    const listUnlockAttentionRequests = async (): Promise<BackgroundUnlockAttentionRequestedPayload[]> => {
      const snapshot = await active.core.wallet.attention.getSnapshot();
      return snapshot.queue.filter((request): request is BackgroundUnlockAttentionRequestedPayload => {
        return request.reason === "unlock_required";
      });
    };

    return {
      subscribeUnlockAttentionEvents,
      listUnlockAttentionRequests,
      subscribeApprovalEvents,
      dismissApproval: async ({ approvalId }) => {
        await active.core.wallet.approvals.dismiss({ approvalId });
      },
      listPendingApprovals: async () => await active.core.wallet.approvals.listPending(),
      getApprovalDetail: async (approvalId) => await active.core.wallet.approvals.getDetail({ approvalId }),
      getSessionStatus: async () => await active.core.wallet.session.getStatus(),
    };
  };

  const shutdown = async () => {
    runtimeGeneration += 1;
    provider = null;
    walletMethodExecutor = null;
    const activeRuntime = runtimeCache?.runtime ?? null;
    const pendingRuntimeCachePromise = runtimeCachePromise;
    runtimeCache = null;
    runtimeCachePromise = null;

    if (activeRuntime) {
      await activeRuntime.shutdown();
      return;
    }

    if (!pendingRuntimeCachePromise) {
      return;
    }

    try {
      await pendingRuntimeCachePromise;
    } catch {
      // Boot failed or was interrupted while shutting down. Nothing else to do.
    } finally {
      runtimeCache = null;
    }
  };

  return {
    initializeRuntime,
    getCoreReady,
    getOrInitProvider,
    getOrInitWalletMethodExecutor,
    subscribeWalletEvents,
    getOrInitUiEntryAccess,
    shutdown,
  };
};
