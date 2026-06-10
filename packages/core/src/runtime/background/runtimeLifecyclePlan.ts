import { buildNetworkRuntimeInput } from "../../chains/runtime/config.js";
import type { NetworkStateInput } from "../../chains/runtime/types.js";
import type { Messenger } from "../../messenger/Messenger.js";
import type { BackgroundStateServices } from "./backgroundStateServices.js";
import { RuntimeHydrationError } from "./errors.js";
import type { NetworkBootstrap } from "./networkBootstrap.js";
import type { RuntimeLifecycle } from "./runtimeLifecycle.js";
import { type RuntimePlugin, runPluginHooks, startPlugins } from "./runtimePlugins.js";
import type { SessionLayerResult } from "./session.js";

export type BackgroundLifecycleHandle = {
  initialize(): Promise<void>;
  start(): void;
  shutdown(): void;
  getIsInitialized(): boolean;
};

type Destroyable = {
  destroy(): void;
};

type RestartRecovery = {
  recoverAfterRestart(): Promise<
    Array<{
      action: { kind: string };
      status: "applied" | "deferred" | "failed";
      error: unknown | null;
    }>
  >;
};

const hydrateCriticalStorage = async (
  owner: string,
  resource: string,
  task: () => Promise<unknown> | undefined,
): Promise<void> => {
  try {
    const pending = task();
    if (!pending) {
      return;
    }
    await pending;
  } catch (error) {
    if (error instanceof RuntimeHydrationError) {
      throw error;
    }
    throw new RuntimeHydrationError({ owner, resource, cause: error });
  }
};

export const createBackgroundRuntimeLifecycle = ({
  runtimeLifecycle,
  stateServices,
  permissionsReady,
  deferredNetworkInitialState,
  registeredNamespaces,
  transactionRecovery,
  transactionRestartRecovery,
  networkBootstrap,
  sessionLayer,
  rpcClientRegistry,
  bus,
  logger,
}: {
  runtimeLifecycle: RuntimeLifecycle;
  stateServices: BackgroundStateServices;
  permissionsReady: Promise<void>;
  deferredNetworkInitialState: NetworkStateInput | null;
  registeredNamespaces: ReadonlySet<string>;
  transactionRecovery: RestartRecovery;
  transactionRestartRecovery?: "run" | "skip";
  networkBootstrap: NetworkBootstrap;
  sessionLayer: SessionLayerResult;
  rpcClientRegistry: Destroyable;
  bus: Messenger;
  logger: (message: string, error?: unknown) => void;
}): BackgroundLifecycleHandle => {
  const coreReadyPlugin: RuntimePlugin = {
    name: "coreReady",
    initialize: async () => {
      await hydrateCriticalStorage("chains", "customChains", () => stateServices.supportedChains.whenReady());
      await hydrateCriticalStorage("accounts", "accounts", () => stateServices.accounts.whenReady?.());

      if (deferredNetworkInitialState) {
        const deferredChains = deferredNetworkInitialState.availableChainRefs.map((chainRef) => {
          const metadata = stateServices.supportedChains.getChain(chainRef)?.metadata;
          if (!metadata) {
            throw new Error(`Deferred network state references missing supported chain ${chainRef}`);
          }
          return metadata;
        });

        const allDeferredChainsAdmitted = deferredChains.every((metadata) =>
          registeredNamespaces.has(metadata.namespace),
        );

        if (allDeferredChainsAdmitted) {
          stateServices.network.replaceState(buildNetworkRuntimeInput(deferredNetworkInitialState, deferredChains));
        } else {
          logger("network: skipped deferred initial state with unregistered namespace chain");
        }
      }
      await hydrateCriticalStorage("permissions", "permissions", () => permissionsReady);
    },
  };

  const transactionRecoveryPlugin: RuntimePlugin = {
    name: "transactionRecovery",
    initialize: async () => {
      try {
        const results = await transactionRecovery.recoverAfterRestart();
        const failed = results.find((result) => result.status === "failed") ?? null;
        if (failed) {
          throw failed.error ?? new Error(`Failed to apply transaction restart action ${failed.action.kind}`);
        }
      } catch (error) {
        throw new RuntimeHydrationError({
          owner: "transactions",
          resource: "restartRecovery",
          cause: error,
        });
      }
    },
  };

  const networkBootstrapPlugin: RuntimePlugin = {
    name: "networkBootstrap",
    initialize: () => networkBootstrap.loadPreferences(),
    hydrate: async () => {
      networkBootstrap.requestSync();
    },
    afterHydration: () => networkBootstrap.flushPendingSync(),
    start: () => networkBootstrap.start(),
    destroy: () => networkBootstrap.destroy(),
  };

  const sessionPlugin: RuntimePlugin = {
    name: "sessionLayer",
    hydrate: () => sessionLayer.hydrateVaultMeta(),
    start: () => sessionLayer.attachSessionListeners(),
    destroy: () => {
      sessionLayer.cleanupVaultPersistTimer();
      sessionLayer.detachSessionListeners();
      sessionLayer.destroySessionLayer();
    },
  };

  const accountSelectionServicePlugin: RuntimePlugin = {
    name: "accountSelectionService",
    destroy: () => {
      try {
        stateServices.accounts.destroy?.();
      } catch (error) {
        logger("lifecycle: failed to destroy account selection service", error);
      }
    },
  };

  const rpcClientsPlugin: RuntimePlugin = {
    name: "rpcClients",
    destroy: () => rpcClientRegistry.destroy(),
  };

  const busPlugin: RuntimePlugin = {
    name: "messenger",
    destroy: () => bus.clear(),
  };

  const initializeOrder =
    transactionRestartRecovery === "skip"
      ? ([coreReadyPlugin, networkBootstrapPlugin] as const)
      : ([coreReadyPlugin, transactionRecoveryPlugin, networkBootstrapPlugin] as const);
  const hydrateOrder = [networkBootstrapPlugin, sessionPlugin] as const;
  const afterHydrationOrder = [networkBootstrapPlugin] as const;
  const startOrder = [networkBootstrapPlugin, sessionPlugin] as const;
  const destroyOrder = [
    sessionPlugin,
    networkBootstrapPlugin,
    accountSelectionServicePlugin,
    rpcClientsPlugin,
    busPlugin,
  ] as const;

  return {
    initialize: async () =>
      runtimeLifecycle.initialize(async () => {
        await runPluginHooks([...initializeOrder], "initialize");
        await runtimeLifecycle.withHydration(async () => {
          await runPluginHooks([...hydrateOrder], "hydrate");
        });
        await runPluginHooks([...afterHydrationOrder], "afterHydration");
      }),
    start: () =>
      runtimeLifecycle.start(() => {
        startPlugins([...startOrder]);
      }),
    shutdown: () =>
      runtimeLifecycle.destroy(() => {
        for (const plugin of destroyOrder) {
          try {
            plugin.destroy?.();
          } catch {
            // best-effort
          }
        }
      }),
    getIsInitialized: () => runtimeLifecycle.getIsInitialized(),
  };
};
