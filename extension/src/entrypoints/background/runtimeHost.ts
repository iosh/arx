import type { ApprovalTerminalReason } from "@arx/core/controllers/approval";
import { createLogger, disableDebugNamespaces, enableDebugNamespaces, extendLogger } from "@arx/core/logger";
import {
  createBackgroundRuntime,
  type ProviderRuntimeAccess,
  type UiPlatformAdapter,
  type UiRuntimeAccess,
} from "@arx/core/runtime";
import { ATTENTION_REQUESTED, type AttentionRequest } from "@arx/core/services";
import browser from "webextension-polyfill";
import { INSTALLED_NAMESPACE_MANIFESTS } from "@/platform/namespaces/installed";
import { getExtensionStorage } from "@/platform/storage";
import { isInternalOrigin } from "./origin";

type BackgroundRuntimeCache = {
  runtime: ReturnType<typeof createBackgroundRuntime>;
};

export type BackgroundRuntimeHost = {
  initializeRuntime: () => Promise<void>;
  getOrInitProviderAccess: () => Promise<ProviderRuntimeAccess>;
  getOrInitUiAccess: (params: BackgroundUiAccessParams) => Promise<UiRuntimeAccess>;
  getOrInitApprovalUiAccess: () => Promise<BackgroundApprovalUiAccess>;
  destroy: () => void;
  applyDebugNamespacesFromEnv: () => void;
};

export type BackgroundUiAccessParams = {
  platform: UiPlatformAdapter;
  uiOrigin: string;
};

type BackgroundRuntimeApprovals = ReturnType<typeof createBackgroundRuntime>["controllers"]["approvals"];
type BackgroundRuntimeUnlock = ReturnType<typeof createBackgroundRuntime>["services"]["session"]["unlock"];

type ApprovalCreatedListener = Parameters<BackgroundRuntimeApprovals["onCreated"]>[0];
type ApprovalFinishedListener = Parameters<BackgroundRuntimeApprovals["onFinished"]>[0];
type ApprovalStateChangedListener = Parameters<BackgroundRuntimeApprovals["onStateChanged"]>[0];
type ApprovalSessionLockedListener = Parameters<BackgroundRuntimeUnlock["onLocked"]>[0];
type ApprovalSessionStateChangedListener = Parameters<BackgroundRuntimeUnlock["onStateChanged"]>[0];

export type BackgroundAttentionRequestedPayload = Pick<
  AttentionRequest,
  "reason" | "origin" | "method" | "chainRef" | "namespace"
>;

export type BackgroundApprovalUiAccess = {
  subscribeAttentionRequested: (listener: (payload: BackgroundAttentionRequestedPayload) => void) => () => void;
  subscribeApprovalCreated: (listener: ApprovalCreatedListener) => () => void;
  subscribeApprovalFinished: (listener: ApprovalFinishedListener) => () => void;
  subscribeApprovalStateChanged: (listener: ApprovalStateChangedListener) => () => void;
  subscribeSessionLocked: (listener: ApprovalSessionLockedListener) => () => void;
  subscribeSessionStateChanged: (listener: ApprovalSessionStateChangedListener) => () => void;
  cancelApproval: (params: { id: string; reason: ApprovalTerminalReason }) => Promise<void>;
  listPendingApprovalIds: () => string[];
  hasInitializedVault: () => boolean;
  isUnlocked: () => boolean;
};

export const createBackgroundRuntimeHost = (deps: { extensionOrigin: string }): BackgroundRuntimeHost => {
  let runtimeCache: BackgroundRuntimeCache | null = null;
  let runtimeCachePromise: Promise<BackgroundRuntimeCache> | null = null;
  let uiAccess: UiRuntimeAccess | null = null;
  let uiAccessPromise: Promise<UiRuntimeAccess> | null = null;
  let uiAccessParams: BackgroundUiAccessParams | null = null;
  let destroyed = false;

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
    if (destroyed) {
      throw new Error("Background runtime host is destroyed");
    }
    if (runtimeCache) return runtimeCache;
    if (runtimeCachePromise) return runtimeCachePromise;

    runtimeCachePromise = (async () => {
      const storage = getExtensionStorage();
      const runtime = createBackgroundRuntime({
        store: {
          ports: {
            accounts: storage.ports.accounts,
            keyringMetas: storage.ports.keyringMetas,
            permissions: storage.ports.permissions,
            transactions: storage.ports.transactions,
          },
        },
        networkPreferences: { port: storage.ports.networkPreferences },
        storage: { vaultMetaPort: storage.ports.vaultMeta },
        settings: { port: storage.ports.settings },
        chainDefinitions: { port: storage.ports.chainDefinitions },
        rpcEngine: {
          env: {
            isInternalOrigin: (origin) => isInternalOrigin(origin, deps.extensionOrigin),
            shouldRequestUnlockAttention: () => true,
          },
        },
        namespaces: {
          manifests: INSTALLED_NAMESPACE_MANIFESTS,
        },
      });

      await runtime.lifecycle.initialize();
      runtime.lifecycle.start();

      if (destroyed) {
        runtime.lifecycle.destroy();
        throw new Error("Background runtime host is destroyed");
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
    if (uiAccessParams.platform === next.platform && uiAccessParams.uiOrigin === next.uiOrigin) return;

    throw new Error("Background runtime host UI access parameters must remain stable across calls");
  };

  const getOrInitUiAccess = async ({ platform, uiOrigin }: BackgroundUiAccessParams): Promise<UiRuntimeAccess> => {
    if (destroyed) {
      throw new Error("Background runtime host is destroyed");
    }
    assertUiAccessParamsMatch({ platform, uiOrigin });
    if (uiAccess) return uiAccess;
    if (uiAccessPromise) return await uiAccessPromise;
    uiAccessParams = { platform, uiOrigin };

    uiAccessPromise = (async () => {
      const active = await getOrInitRuntimeCache();
      const access = active.runtime.createUiAccess({ platform, uiOrigin });

      if (destroyed) {
        throw new Error("Background runtime host is destroyed");
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

  const getOrInitApprovalUiAccess = async (): Promise<BackgroundApprovalUiAccess> => {
    const active = await getOrInitRuntimeCache();

    return {
      subscribeAttentionRequested: (listener) => active.runtime.bus.subscribe(ATTENTION_REQUESTED, listener),
      subscribeApprovalCreated: (listener) => active.runtime.controllers.approvals.onCreated(listener),
      subscribeApprovalFinished: (listener) => active.runtime.controllers.approvals.onFinished(listener),
      subscribeApprovalStateChanged: (listener) => active.runtime.controllers.approvals.onStateChanged(listener),
      subscribeSessionLocked: (listener) => active.runtime.services.session.unlock.onLocked(listener),
      subscribeSessionStateChanged: (listener) => active.runtime.services.session.unlock.onStateChanged(listener),
      cancelApproval: (params) => active.runtime.controllers.approvals.cancel(params),
      listPendingApprovalIds: () => active.runtime.controllers.approvals.getState().pending.map((item) => item.id),
      hasInitializedVault: () => active.runtime.services.session.vault.getStatus().hasEnvelope,
      isUnlocked: () => active.runtime.services.session.unlock.isUnlocked(),
    };
  };

  const destroy = () => {
    destroyed = true;
    uiAccess = null;
    uiAccessParams = null;
    runtimeCache?.runtime.lifecycle.destroy();
    runtimeCache = null;
  };

  return {
    initializeRuntime,
    getOrInitProviderAccess,
    getOrInitUiAccess,
    getOrInitApprovalUiAccess,
    destroy,
    applyDebugNamespacesFromEnv,
  };
};
