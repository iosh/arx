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
import type { ControllerSnapshot } from "./types";

export type BackgroundContext = {
  runtime: ReturnType<typeof createBackgroundRuntime>;
  controllers: ReturnType<typeof createBackgroundRuntime>["controllers"];
  engine: ReturnType<typeof createBackgroundRuntime>["rpc"]["engine"];
  session: ReturnType<typeof createBackgroundRuntime>["services"]["session"];
  keyring: ReturnType<typeof createBackgroundRuntime>["services"]["keyring"];
  attention: ReturnType<typeof createBackgroundRuntime>["services"]["attention"];
};

export type BackgroundRuntimeHost = {
  getOrInitContext: () => Promise<BackgroundContext>;
  getControllerSnapshot: () => ControllerSnapshot;
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

  const getControllerSnapshot = (): ControllerSnapshot => {
    if (!context) throw new Error("Background context is not initialized");
    const { controllers, session } = context;
    const activeChain = controllers.network.getActiveChain();
    const networkState = controllers.network.getState();
    const isUnlocked = session.unlock.isUnlocked();
    const chainRef = activeChain.chainRef;
    const accounts = isUnlocked
      ? controllers.accounts.getAccountsForNamespace({ namespace: activeChain.namespace, chainRef })
      : [];

    return {
      chain: { chainId: activeChain.chainId, chainRef: activeChain.chainRef },
      accounts,
      isUnlocked,
      meta: {
        activeChain: activeChain.chainRef,
        activeNamespace: activeChain.namespace,
        supportedChains: networkState.knownChains.map((chain) => chain.chainRef),
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
        chainRegistry: { port: storage.ports.chainRegistry },
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

  return { getOrInitContext, getControllerSnapshot, persistVaultMeta, destroy, applyDebugNamespacesFromEnv };
};
