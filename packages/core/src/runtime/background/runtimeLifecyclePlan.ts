import { buildNetworkRuntimeInput } from "../../controllers/network/config.js";
import type { NetworkStateInput } from "../../controllers/network/types.js";
import type { Messenger } from "../../messenger/Messenger.js";
import type { ControllersBase } from "./controllers.js";
import type { NetworkBootstrap } from "./networkBootstrap.js";
import type { RuntimeLifecycle } from "./runtimeLifecycle.js";
import { type RuntimePlugin, runPluginHooks, startPlugins } from "./runtimePlugins.js";
import type { SessionLayerResult } from "./session.js";
import type { TransactionsLifecycle } from "./transactionsLifecycle.js";

export type BackgroundLifecycleHandle = {
  initialize(): Promise<void>;
  start(): void;
  shutdown(): void;
  getIsInitialized(): boolean;
};

type Destroyable = {
  destroy(): void;
};

export const createBackgroundRuntimeLifecycle = ({
  runtimeLifecycle,
  controllersBase,
  permissionsReady,
  deferredNetworkInitialState,
  registeredNamespaces,
  transactionsLifecycle,
  networkBootstrap,
  sessionLayer,
  rpcClientRegistry,
  engine,
  bus,
  logger,
}: {
  runtimeLifecycle: RuntimeLifecycle;
  controllersBase: ControllersBase;
  permissionsReady: Promise<void>;
  deferredNetworkInitialState: NetworkStateInput | null;
  registeredNamespaces: ReadonlySet<string>;
  transactionsLifecycle: TransactionsLifecycle;
  networkBootstrap: NetworkBootstrap;
  sessionLayer: SessionLayerResult;
  rpcClientRegistry: Destroyable;
  engine: Destroyable;
  bus: Messenger;
  logger: (message: string, error?: unknown) => void;
}): BackgroundLifecycleHandle => {
  const coreReadyPlugin: RuntimePlugin = {
    name: "coreReady",
    initialize: async () => {
      await controllersBase.chainDefinitions.whenReady();
      await controllersBase.accounts.whenReady?.();

      if (deferredNetworkInitialState) {
        const deferredChains = deferredNetworkInitialState.availableChainRefs.map((chainRef) => {
          const metadata = controllersBase.chainDefinitions.getChain(chainRef)?.metadata;
          if (!metadata) {
            throw new Error(`Deferred network state references missing chain definition ${chainRef}`);
          }
          return metadata;
        });

        const allDeferredChainsAdmitted = deferredChains.every((metadata) =>
          registeredNamespaces.has(metadata.namespace),
        );

        if (allDeferredChainsAdmitted) {
          controllersBase.network.replaceState(buildNetworkRuntimeInput(deferredNetworkInitialState, deferredChains));
        } else {
          logger("network: skipped deferred initial state with unregistered namespace chain");
        }
      }
      await permissionsReady;
    },
  };

  const transactionsPlugin: RuntimePlugin = {
    name: "transactionsLifecycle",
    initialize: () => transactionsLifecycle.initialize(),
    start: () => transactionsLifecycle.start(),
    destroy: () => transactionsLifecycle.destroy(),
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

  const accountsControllerPlugin: RuntimePlugin = {
    name: "accountsController",
    destroy: () => {
      try {
        controllersBase.accounts.destroy?.();
      } catch (error) {
        logger("lifecycle: failed to destroy accounts controller", error);
      }
    },
  };

  const rpcClientsPlugin: RuntimePlugin = {
    name: "rpcClients",
    destroy: () => rpcClientRegistry.destroy(),
  };

  const enginePlugin: RuntimePlugin = {
    name: "rpcEngine",
    destroy: () => engine.destroy(),
  };

  const busPlugin: RuntimePlugin = {
    name: "messenger",
    destroy: () => bus.clear(),
  };

  const initializeOrder = [coreReadyPlugin, transactionsPlugin, networkBootstrapPlugin] as const;
  const hydrateOrder = [networkBootstrapPlugin, sessionPlugin] as const;
  const afterHydrationOrder = [networkBootstrapPlugin] as const;
  const startOrder = [networkBootstrapPlugin, sessionPlugin, transactionsPlugin] as const;
  const destroyOrder = [
    transactionsPlugin,
    sessionPlugin,
    networkBootstrapPlugin,
    accountsControllerPlugin,
    rpcClientsPlugin,
    enginePlugin,
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
