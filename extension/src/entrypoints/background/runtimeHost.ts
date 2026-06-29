import {
  type CoreProviderApi,
  type CoreRuntime,
  createArxWalletRuntime,
  createCoreRuntimeFromArxWalletRuntime,
} from "@arx/core/engine";
import type { MethodExecutor } from "@arx/core/invoke";
import { createLogger, disableDebugNamespaces, enableDebugNamespaces, extendLogger } from "@arx/core/logger";
import { ATTENTION_REQUESTED, type AttentionRequest } from "@arx/core/services";
import type { ApprovalDetail, ApprovalListEntry, WalletInvalidationEvent } from "@arx/core/wallet";
import browser from "webextension-polyfill";
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
  getOrInitWalletMethodExecutor: (origin: string) => Promise<MethodExecutor>;
  subscribeWalletInvalidation: (listener: (event: WalletInvalidationEvent) => void) => Promise<() => void>;
  getOrInitUiEntryAccess: () => Promise<BackgroundUiEntryAccess>;
  shutdown: () => Promise<void>;
  applyDebugNamespacesFromEnv: () => void;
};

export type BackgroundUnlockAttentionRequestedPayload = AttentionRequest & { reason: "unlock_required" };

export type BackgroundUiEntryAccess = {
  subscribeUnlockAttentionRequested: (
    listener: (payload: BackgroundUnlockAttentionRequestedPayload) => void,
  ) => () => void;
  subscribeApprovalInvalidation: (listener: () => void) => () => void;
  dismissApproval: (params: { approvalId: string }) => Promise<void>;
  listPendingApprovals: () => Promise<ApprovalListEntry[]>;
  getApprovalDetail: (approvalId: string) => Promise<ApprovalDetail | null>;
  hasInitializedVault: () => boolean;
};

const isUnlockAttentionRequest = (payload: AttentionRequest): payload is BackgroundUnlockAttentionRequestedPayload => {
  return payload.reason === "unlock_required";
};

export const createBackgroundRuntimeHost = (deps: { extensionOrigin: string }): BackgroundRuntimeHost => {
  let runtimeCache: BackgroundRuntimeCache | null = null;
  let runtimeCachePromise: Promise<BackgroundRuntimeCache> | null = null;
  let provider: CoreProviderApi | null = null;
  let walletMethodExecutor: MethodExecutor | null = null;
  let walletMethodExecutorOrigin: string | null = null;
  let runtimeGeneration = 0;

  const runtimeLog = createLogger("bg:runtime");
  const hostLog = extendLogger(runtimeLog, "host");

  const applyDebugNamespacesFromEnv = () => {
    const raw: unknown = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.VITE_ARX_DEBUG_NAMESPACES;
    const namespaces = typeof raw === "string" ? raw.trim() : "";

    if (!namespaces) {
      disableDebugNamespaces();
      return;
    }

    enableDebugNamespaces(namespaces);
  };

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
        namespaces: INSTALLED_NAMESPACES.engine,
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
      hostLog("runtime initialized", { runtimeId: browser.runtime.id });
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

  const assertWalletMethodExecutorOriginStable = (origin: string) => {
    if (!walletMethodExecutorOrigin) return;
    if (walletMethodExecutorOrigin === origin) {
      return;
    }

    throw new Error("Background runtime host wallet method executor origin must remain stable across calls");
  };

  const getOrInitWalletMethodExecutor = async (origin: string): Promise<MethodExecutor> => {
    assertWalletMethodExecutorOriginStable(origin);
    if (walletMethodExecutor) {
      return walletMethodExecutor;
    }

    walletMethodExecutorOrigin = origin;

    try {
      const active = await getOrInitRuntimeCache();
      walletMethodExecutor = active.runtime.createWalletMethodExecutor({ origin });
      return walletMethodExecutor;
    } catch (error) {
      walletMethodExecutorOrigin = null;
      throw error;
    }
  };

  const subscribeWalletInvalidation = async (listener: (event: WalletInvalidationEvent) => void) => {
    const active = await getOrInitRuntimeCache();
    return active.runtime.subscribeWalletInvalidation(listener);
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
    const subscribeApprovalInvalidation = (listener: () => void) =>
      active.runtime.subscribeWalletInvalidation((event) => {
        if (event.topic !== "approvals") {
          return;
        }

        listener();
      });

    return {
      subscribeUnlockAttentionRequested: (listener) =>
        active.runtime.bus.subscribe(ATTENTION_REQUESTED, (payload) => {
          if (!isUnlockAttentionRequest(payload)) {
            return;
          }

          listener(payload);
        }),
      subscribeApprovalInvalidation,
      dismissApproval: async ({ approvalId }) => {
        await active.core.wallet.approvals.dismiss({ approvalId });
      },
      listPendingApprovals: async () => await active.core.wallet.approvals.listPending(),
      getApprovalDetail: async (approvalId) => await active.core.wallet.approvals.getDetail({ approvalId }),
      hasInitializedVault: () => active.runtime.services.sessionStatus.hasInitializedVault(),
    };
  };

  const shutdown = async () => {
    runtimeGeneration += 1;
    provider = null;
    walletMethodExecutor = null;
    walletMethodExecutorOrigin = null;
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
    subscribeWalletInvalidation,
    getOrInitUiEntryAccess,
    shutdown,
    applyDebugNamespacesFromEnv,
  };
};
