import type { ApprovalTerminalReason } from "@arx/core/controllers/approval";
import { createArxWalletRuntime } from "@arx/core/engine";
import { createLogger, disableDebugNamespaces, enableDebugNamespaces, extendLogger } from "@arx/core/logger";
import type { ProviderRuntimeAccess, UiPlatformAdapter, UiRuntimeAccess } from "@arx/core/runtime";
import { ATTENTION_REQUESTED, type AttentionRequest } from "@arx/core/services";
import browser from "webextension-polyfill";
import { INSTALLED_NAMESPACES } from "@/platform/namespaces/installed";
import { getExtensionStorage } from "@/platform/storage";
import { isInternalOrigin } from "./origin";

type BackgroundRuntimeCache = {
  runtime: Awaited<ReturnType<typeof createArxWalletRuntime>>;
};

export type BackgroundRuntimeHost = {
  initializeRuntime: () => Promise<void>;
  getOrInitProviderAccess: () => Promise<ProviderRuntimeAccess>;
  getOrInitUiAccess: (params: BackgroundUiAccessParams) => Promise<UiRuntimeAccess>;
  getOrInitApprovalPopupAccess: () => Promise<BackgroundApprovalPopupAccess>;
  shutdown: () => Promise<void>;
  applyDebugNamespacesFromEnv: () => void;
};

export type BackgroundUiAccessParams = {
  platform: UiPlatformAdapter;
  surfaceOrigin: string;
};

type BackgroundRuntime = Awaited<ReturnType<typeof createArxWalletRuntime>>;
type BackgroundRuntimeApprovals = BackgroundRuntime["controllers"]["approvals"];
type BackgroundRuntimeUnlock = BackgroundRuntime["services"]["session"]["unlock"];

type ApprovalCreatedListener = Parameters<BackgroundRuntimeApprovals["onCreated"]>[0];
type ApprovalFinishedListener = Parameters<BackgroundRuntimeApprovals["onFinished"]>[0];
type ApprovalStateChangedListener = Parameters<BackgroundRuntimeApprovals["onStateChanged"]>[0];
type ApprovalSessionLockedListener = Parameters<BackgroundRuntimeUnlock["onLocked"]>[0];

export type BackgroundUnlockAttentionRequestedPayload = AttentionRequest & { reason: "unlock_required" };

export type BackgroundApprovalPopupAccess = {
  subscribeUnlockAttentionRequested: (
    listener: (payload: BackgroundUnlockAttentionRequestedPayload) => void,
  ) => () => void;
  subscribeApprovalCreated: (listener: ApprovalCreatedListener) => () => void;
  subscribeApprovalFinished: (listener: ApprovalFinishedListener) => () => void;
  subscribeApprovalStateChanged: (listener: ApprovalStateChangedListener) => () => void;
  subscribeSessionLocked: (listener: ApprovalSessionLockedListener) => () => void;
  cancelApproval: (params: { id: string; reason: ApprovalTerminalReason }) => Promise<void>;
  cancelPendingApprovals: (reason: ApprovalTerminalReason) => Promise<void>;
  getPendingApprovalCount: () => number;
  hasInitializedVault: () => boolean;
};

const isUnlockAttentionRequest = (payload: AttentionRequest): payload is BackgroundUnlockAttentionRequestedPayload => {
  return payload.reason === "unlock_required";
};

export const createBackgroundRuntimeHost = (deps: { extensionOrigin: string }): BackgroundRuntimeHost => {
  let runtimeCache: BackgroundRuntimeCache | null = null;
  let runtimeCachePromise: Promise<BackgroundRuntimeCache> | null = null;
  let uiAccess: UiRuntimeAccess | null = null;
  let uiAccessPromise: Promise<UiRuntimeAccess> | null = null;
  let uiAccessParams: BackgroundUiAccessParams | null = null;
  let runtimeGeneration = 0;

  const runtimeLog = createLogger("bg:runtime");
  const hostLog = extendLogger(runtimeLog, "host");

  const applyDebugNamespacesFromEnv = () => {
    const raw: unknown = import.meta.env.VITE_ARX_DEBUG_NAMESPACES;
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
          ports: {
            accounts: storage.ports.accounts,
            chainDefinitions: storage.ports.chainDefinitions,
            keyringMetas: storage.ports.keyringMetas,
            networkPreferences: storage.ports.networkPreferences,
            permissions: storage.ports.permissions,
            settings: storage.ports.settings,
            transactions: storage.ports.transactions,
          },
          vaultMetaPort: storage.ports.vaultMeta,
        },
        runtime: {
          lifecycleLabel: "createBackgroundRuntimeHost",
          rpcEngine: {
            env: {
              isInternalOrigin: (origin) => isInternalOrigin(origin, deps.extensionOrigin),
              shouldRequestUnlockAttention: () => true,
            },
          },
        },
      });

      if (bootGeneration !== runtimeGeneration) {
        await runtime.shutdown();
        throw new Error("Background runtime host was reset during boot");
      }

      const next: BackgroundRuntimeCache = { runtime };

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

  const assertUiAccessParamsMatch = (next: BackgroundUiAccessParams) => {
    if (!uiAccessParams) return;
    if (uiAccessParams.platform === next.platform && uiAccessParams.surfaceOrigin === next.surfaceOrigin) return;

    throw new Error("Background runtime host UI access parameters must remain stable across calls");
  };

  const getOrInitUiAccess = async ({ platform, surfaceOrigin }: BackgroundUiAccessParams): Promise<UiRuntimeAccess> => {
    assertUiAccessParamsMatch({ platform, surfaceOrigin });
    if (uiAccess) return uiAccess;
    if (uiAccessPromise) return await uiAccessPromise;
    uiAccessParams = { platform, surfaceOrigin };
    const accessGeneration = runtimeGeneration;

    uiAccessPromise = (async () => {
      const active = await getOrInitRuntimeCache();
      const access = active.runtime.createUiAccess({ platform, surfaceOrigin });

      if (accessGeneration !== runtimeGeneration) {
        throw new Error("Background runtime host was reset during UI access bootstrap");
      }

      uiAccess = access;
      return access;
    })();

    try {
      return await uiAccessPromise;
    } catch (error) {
      uiAccessParams = null;
      throw error;
    } finally {
      uiAccessPromise = null;
    }
  };

  const getOrInitProviderAccess = async (): Promise<ProviderRuntimeAccess> => {
    const active = await getOrInitRuntimeCache();
    return active.runtime.providerAccess;
  };

  const getOrInitApprovalPopupAccess = async (): Promise<BackgroundApprovalPopupAccess> => {
    const active = await getOrInitRuntimeCache();

    return {
      subscribeUnlockAttentionRequested: (listener) =>
        active.runtime.bus.subscribe(ATTENTION_REQUESTED, (payload) => {
          if (!isUnlockAttentionRequest(payload)) {
            return;
          }

          listener(payload);
        }),
      subscribeApprovalCreated: (listener) => active.runtime.controllers.approvals.onCreated(listener),
      subscribeApprovalFinished: (listener) => active.runtime.controllers.approvals.onFinished(listener),
      subscribeApprovalStateChanged: (listener) => active.runtime.controllers.approvals.onStateChanged(listener),
      subscribeSessionLocked: (listener) => active.runtime.services.session.unlock.onLocked(listener),
      cancelApproval: (params) => active.runtime.controllers.approvals.cancel(params),
      cancelPendingApprovals: async (reason) => {
        const pending = active.runtime.controllers.approvals.getState().pending;
        await Promise.all(pending.map((item) => active.runtime.controllers.approvals.cancel({ id: item.id, reason })));
      },
      getPendingApprovalCount: () => active.runtime.controllers.approvals.getState().pending.length,
      hasInitializedVault: () => active.runtime.services.sessionStatus.hasInitializedVault(),
    };
  };

  const shutdown = async () => {
    runtimeGeneration += 1;
    uiAccess = null;
    uiAccessParams = null;
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
    getOrInitProviderAccess,
    getOrInitUiAccess,
    getOrInitApprovalPopupAccess,
    shutdown,
    applyDebugNamespacesFromEnv,
  };
};
