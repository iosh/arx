import {
  createBackgroundRuntime,
  createLogger,
  disableDebugNamespaces,
  enableDebugNamespaces,
  extendLogger,
} from "@arx/core";
import browser from "webextension-polyfill";
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
  networkPreferences: ReturnType<typeof createBackgroundRuntime>["services"]["networkPreferences"];
};

export type BackgroundRuntimeHost = {
  getOrInitContext: () => Promise<BackgroundContext>;
  getProviderSnapshot: (namespace: string) => ProviderBridgeSnapshot;
  persistVaultMeta: (target?: BackgroundContext | null) => Promise<void>;
  destroy: () => void;
  applyDebugNamespacesFromEnv: () => void;
};

export const createBackgroundRuntimeHost = (deps: { extensionOrigin: string }): BackgroundRuntimeHost => {
  let context: BackgroundContext | null = null;
  let contextPromise: Promise<BackgroundContext> | null = null;
  let destroyed = false;

  const runtimeLog = createLogger("bg:runtime");
  const hostLog = extendLogger(runtimeLog, "host");

  const persistVaultMeta = async (target?: BackgroundContext | null) => {
    const active = target ?? context;
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

  const destroy = () => {
    destroyed = true;
    context?.runtime.lifecycle.destroy();
    context = null;
  };

  return { getOrInitContext, getProviderSnapshot, persistVaultMeta, destroy, applyDebugNamespacesFromEnv };
};
