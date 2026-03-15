import type { ApprovalTerminalReason } from "@arx/core/controllers/approval";
import { createLogger, disableDebugNamespaces, enableDebugNamespaces, extendLogger } from "@arx/core/logger";
import { createBackgroundRuntime } from "@arx/core/runtime";
import { ATTENTION_REQUESTED, ATTENTION_STATE_CHANGED, type AttentionRequest } from "@arx/core/services";
import browser from "webextension-polyfill";
import { INSTALLED_NAMESPACE_MANIFESTS } from "@/platform/namespaces/installed";
import { getExtensionStorage } from "@/platform/storage";
import { isInternalOrigin } from "./origin";
import type { ProviderBridgeSnapshot } from "./types";

export type BackgroundContext = {
  runtime: ReturnType<typeof createBackgroundRuntime>;
  controllers: ReturnType<typeof createBackgroundRuntime>["controllers"];
  engine: ReturnType<typeof createBackgroundRuntime>["rpc"]["engine"];
  session: ReturnType<typeof createBackgroundRuntime>["services"]["session"];
  keyring: ReturnType<typeof createBackgroundRuntime>["services"]["keyring"];
  attention: ReturnType<typeof createBackgroundRuntime>["services"]["attention"];
  chainViews: ReturnType<typeof createBackgroundRuntime>["services"]["chainViews"];
  permissionViews: ReturnType<typeof createBackgroundRuntime>["services"]["permissionViews"];
  networkPreferences: ReturnType<typeof createBackgroundRuntime>["services"]["networkPreferences"];
};

export type BackgroundRuntimeHost = {
  initializeRuntime: () => Promise<void>;
  getOrInitContext: () => Promise<BackgroundContext>;
  getOrInitUiBridgeAccess: () => Promise<BackgroundUiBridgeAccess>;
  getOrInitProviderEventsAccess: () => Promise<BackgroundProviderEventsAccess>;
  getOrInitApprovalUiAccess: () => Promise<BackgroundApprovalUiAccess>;
  getProviderSnapshot: (namespace: string) => ProviderBridgeSnapshot;
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
type BackgroundRuntimeNetworkPreferences = ReturnType<typeof createBackgroundRuntime>["services"]["networkPreferences"];
type BackgroundRuntimeUnlock = ReturnType<typeof createBackgroundRuntime>["services"]["session"]["unlock"];

type ProviderEventsUnlockedListener = Parameters<BackgroundRuntimeUnlock["onUnlocked"]>[0];
type ProviderEventsLockedListener = Parameters<BackgroundRuntimeUnlock["onLocked"]>[0];
type ProviderEventsNetworkPreferencesListener = Parameters<BackgroundRuntimeNetworkPreferences["subscribeChanged"]>[0];
type ApprovalCreatedListener = Parameters<BackgroundRuntimeApprovals["onCreated"]>[0];
type ApprovalFinishedListener = Parameters<BackgroundRuntimeApprovals["onFinished"]>[0];
type ApprovalStateChangedListener = Parameters<BackgroundRuntimeApprovals["onStateChanged"]>[0];
type ApprovalSessionLockedListener = Parameters<BackgroundRuntimeUnlock["onLocked"]>[0];
type ApprovalSessionStateChangedListener = Parameters<BackgroundRuntimeUnlock["onStateChanged"]>[0];

export type BackgroundAttentionRequestedPayload = Pick<
  AttentionRequest,
  "reason" | "origin" | "method" | "chainRef" | "namespace"
>;

export type BackgroundProviderEventsAccess = {
  getProviderSnapshot: (namespace: string) => ProviderBridgeSnapshot;
  getActiveChainByNamespace: () => Record<string, string>;
  subscribeSessionUnlocked: (listener: ProviderEventsUnlockedListener) => () => void;
  subscribeSessionLocked: (listener: ProviderEventsLockedListener) => () => void;
  subscribeNetworkStateChanged: (listener: () => void) => () => void;
  subscribeNetworkPreferencesChanged: (listener: ProviderEventsNetworkPreferencesListener) => () => void;
  subscribeAccountsStateChanged: (listener: () => void) => () => void;
  subscribePermissionsStateChanged: (listener: () => void) => () => void;
};

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
  let context: BackgroundContext | null = null;
  let contextPromise: Promise<BackgroundContext> | null = null;
  let destroyed = false;

  const runtimeLog = createLogger("bg:runtime");
  const hostLog = extendLogger(runtimeLog, "host");

  const persistVaultMeta = async () => {
    const active = context;
    if (!active) {
      console.warn("[background] persistVaultMeta called before context initialized");
      return;
    }

    try {
      await active.session.persistVaultMeta();
    } catch (error) {
      console.warn("[background] failed to persist vault meta", error);
    }
  };

  const getProviderSnapshot = (namespace: string): ProviderBridgeSnapshot => {
    if (!context) throw new Error("Background context is not initialized");
    const { session, chainViews } = context;
    const providerMeta = chainViews.buildProviderMeta(namespace);
    const providerChain = chainViews.getProviderChainView(namespace);
    const isUnlocked = session.unlock.isUnlocked();
    const supportedChains = providerMeta.supportedChains.filter((chainRef) => chainRef.startsWith(`${namespace}:`));

    return {
      namespace,
      chain: { chainId: providerChain.chainId, chainRef: providerChain.chainRef },
      isUnlocked,
      meta: {
        activeChainByNamespace: {
          [namespace]: providerMeta.activeChainByNamespace[namespace] ?? providerChain.chainRef,
        },
        supportedChains,
      },
    };
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
    await getOrInitContext();
  };

  const getOrInitContext = async (): Promise<BackgroundContext> => {
    if (destroyed) {
      throw new Error("Background runtime host is destroyed");
    }
    if (context) return context;
    if (contextPromise) return contextPromise;

    contextPromise = (async () => {
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

      const next: BackgroundContext = {
        runtime,
        controllers: runtime.controllers,
        engine: runtime.rpc.engine,
        session: runtime.services.session,
        keyring: runtime.services.keyring,
        attention: runtime.services.attention,
        chainViews: runtime.services.chainViews,
        permissionViews: runtime.services.permissionViews,
        networkPreferences: runtime.services.networkPreferences,
      };

      context = next;
      hostLog("context initialized", { runtimeId: browser.runtime.id });
      return next;
    })();

    try {
      return await contextPromise;
    } finally {
      contextPromise = null;
    }
  };

  const getOrInitUiBridgeAccess = async (): Promise<BackgroundUiBridgeAccess> => {
    const active = await getOrInitContext();

    return {
      uiBridgeRuntimeInputs: {
        controllers: active.controllers,
        chainActivation: active.runtime.services.chainActivation,
        chainViews: active.chainViews,
        permissionViews: active.permissionViews,
        networkPreferences: active.networkPreferences,
        accountCodecs: active.runtime.services.accountCodecs,
        session: active.session,
        namespaceBindings: active.runtime.services.namespaceBindings,
        rpcRegistry: active.runtime.rpc.registry,
        keyring: active.keyring,
        attention: active.attention,
        persistVaultMeta,
      },
      subscribeAttentionStateChanged: (listener) => active.runtime.bus.subscribe(ATTENTION_STATE_CHANGED, listener),
    };
  };

  const getOrInitProviderEventsAccess = async (): Promise<BackgroundProviderEventsAccess> => {
    const active = await getOrInitContext();

    return {
      getProviderSnapshot,
      getActiveChainByNamespace: () => active.networkPreferences.getActiveChainByNamespace(),
      subscribeSessionUnlocked: (listener) => active.session.unlock.onUnlocked(listener),
      subscribeSessionLocked: (listener) => active.session.unlock.onLocked(listener),
      subscribeNetworkStateChanged: (listener) => active.controllers.network.onStateChanged(listener),
      subscribeNetworkPreferencesChanged: (listener) => active.networkPreferences.subscribeChanged(listener),
      subscribeAccountsStateChanged: (listener) => active.controllers.accounts.onStateChanged(listener),
      subscribePermissionsStateChanged: (listener) => active.controllers.permissions.onStateChanged(listener),
    };
  };

  const getOrInitApprovalUiAccess = async (): Promise<BackgroundApprovalUiAccess> => {
    const active = await getOrInitContext();

    return {
      subscribeAttentionRequested: (listener) => active.runtime.bus.subscribe(ATTENTION_REQUESTED, listener),
      subscribeApprovalCreated: (listener) => active.controllers.approvals.onCreated(listener),
      subscribeApprovalFinished: (listener) => active.controllers.approvals.onFinished(listener),
      subscribeApprovalStateChanged: (listener) => active.controllers.approvals.onStateChanged(listener),
      subscribeSessionLocked: (listener) => active.session.unlock.onLocked(listener),
      subscribeSessionStateChanged: (listener) => active.session.unlock.onStateChanged(listener),
      cancelApproval: (params) => active.controllers.approvals.cancel(params),
      listPendingApprovalIds: () => active.controllers.approvals.getState().pending.map((item) => item.id),
      hasInitializedVault: () => active.session.vault.getStatus().hasEnvelope,
      isUnlocked: () => active.session.unlock.isUnlocked(),
    };
  };

  const destroy = () => {
    destroyed = true;
    context?.runtime.lifecycle.destroy();
    context = null;
  };

  return {
    initializeRuntime,
    getOrInitContext,
    getOrInitUiBridgeAccess,
    getOrInitProviderEventsAccess,
    getOrInitApprovalUiAccess,
    getProviderSnapshot,
    persistVaultMeta,
    destroy,
    applyDebugNamespacesFromEnv,
  };
};
