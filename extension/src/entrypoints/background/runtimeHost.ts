import type { ApprovalTerminalReason } from "@arx/core/controllers/approval";
import { createLogger, disableDebugNamespaces, enableDebugNamespaces, extendLogger } from "@arx/core/logger";
import { createBackgroundRuntime, type ProviderRuntimeSurface } from "@arx/core/runtime";
import { ATTENTION_REQUESTED, ATTENTION_STATE_CHANGED, type AttentionRequest } from "@arx/core/services";
import browser from "webextension-polyfill";
import { INSTALLED_NAMESPACE_MANIFESTS } from "@/platform/namespaces/installed";
import { getExtensionStorage } from "@/platform/storage";
import { isInternalOrigin } from "./origin";

type BackgroundRuntimeCache = {
  runtime: ReturnType<typeof createBackgroundRuntime>;
};

export type BackgroundRuntimeHost = {
  initializeRuntime: () => Promise<void>;
  getOrInitProviderBridgeAccess: () => Promise<ProviderRuntimeSurface>;
  getOrInitUiBridgeAccess: () => Promise<BackgroundUiBridgeAccess>;
  getOrInitApprovalUiAccess: () => Promise<BackgroundApprovalUiAccess>;
  persistVaultMeta: () => Promise<void>;
  destroy: () => void;
  applyDebugNamespacesFromEnv: () => void;
};

export type BackgroundUiBridgeRuntimeInputs = {
  controllers: ReturnType<typeof createBackgroundRuntime>["controllers"];
  chainActivation: ReturnType<typeof createBackgroundRuntime>["services"]["chainActivation"];
  chainViews: ReturnType<typeof createBackgroundRuntime>["services"]["chainViews"];
  permissionViews: ReturnType<typeof createBackgroundRuntime>["services"]["permissionViews"];
  networkPreferences: ReturnType<typeof createBackgroundRuntime>["services"]["networkPreferences"];
  accountCodecs: ReturnType<typeof createBackgroundRuntime>["services"]["accountCodecs"];
  session: ReturnType<typeof createBackgroundRuntime>["services"]["session"];
  namespaceBindings: ReturnType<typeof createBackgroundRuntime>["services"]["namespaceBindings"];
  rpcRegistry: ReturnType<typeof createBackgroundRuntime>["rpc"]["registry"];
  keyring: ReturnType<typeof createBackgroundRuntime>["services"]["keyring"];
  attention: ReturnType<typeof createBackgroundRuntime>["services"]["attention"];
  persistVaultMeta: () => Promise<void>;
};

export type BackgroundUiBridgeAccess = {
  uiBridgeRuntimeInputs: BackgroundUiBridgeRuntimeInputs;
  subscribeAttentionStateChanged: (listener: () => void) => () => void;
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
  let destroyed = false;

  const runtimeLog = createLogger("bg:runtime");
  const hostLog = extendLogger(runtimeLog, "host");

  const persistVaultMeta = async () => {
    const active = runtimeCache;
    if (!active) {
      hostLog("persistVaultMeta before runtime initialized");
      return;
    }

    try {
      await active.runtime.services.session.persistVaultMeta();
    } catch (error) {
      hostLog("persistVaultMeta failed", error);
    }
  };

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

  const getOrInitUiBridgeAccess = async (): Promise<BackgroundUiBridgeAccess> => {
    const active = await getOrInitRuntimeCache();

    return {
      uiBridgeRuntimeInputs: {
        controllers: active.runtime.controllers,
        chainActivation: active.runtime.services.chainActivation,
        chainViews: active.runtime.services.chainViews,
        permissionViews: active.runtime.services.permissionViews,
        networkPreferences: active.runtime.services.networkPreferences,
        accountCodecs: active.runtime.services.accountCodecs,
        session: active.runtime.services.session,
        namespaceBindings: active.runtime.services.namespaceBindings,
        rpcRegistry: active.runtime.rpc.registry,
        keyring: active.runtime.services.keyring,
        attention: active.runtime.services.attention,
        persistVaultMeta,
      },
      subscribeAttentionStateChanged: (listener) => active.runtime.bus.subscribe(ATTENTION_STATE_CHANGED, listener),
    };
  };

  const getOrInitProviderBridgeAccess = async (): Promise<ProviderRuntimeSurface> => {
    const active = await getOrInitRuntimeCache();
    return active.runtime.surfaces.provider;
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
    runtimeCache?.runtime.lifecycle.destroy();
    runtimeCache = null;
  };

  return {
    initializeRuntime,
    getOrInitProviderBridgeAccess,
    getOrInitUiBridgeAccess,
    getOrInitApprovalUiAccess,
    persistVaultMeta,
    destroy,
    applyDebugNamespacesFromEnv,
  };
};
