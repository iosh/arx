import type { ProviderChainSelectionService } from "../../services/store/providerChainSelection/types.js";
import type { BackgroundStateServices } from "./backgroundStateServices.js";
import type { ChainRpcBootstrap } from "./chainRpcBootstrap.js";
import { RuntimeHydrationError } from "./errors.js";
import type { RuntimeLifecycle } from "./runtimeLifecycle.js";
import { type RuntimePlugin, runPluginHooks, startPlugins } from "./runtimePlugins.js";
import type { SessionLayerResult } from "./session.js";

export type BackgroundLifecycleHandle = {
  initialize(): Promise<void>;
  start(): void;
  shutdown(): void;
  getIsInitialized(): boolean;
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

type SubmittedTransactionMonitor = {
  refresh(): Promise<void>;
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
  providerChainSelection,
  hydrationEnabled,
  permissionsReady,
  transactionRecovery,
  submittedTransactionMonitor,
  transactionRestartRecovery,
  chainRpcBootstrap,
  sessionLayer,
  logger,
}: {
  runtimeLifecycle: RuntimeLifecycle;
  stateServices: BackgroundStateServices;
  providerChainSelection: Pick<ProviderChainSelectionService, "loadAll">;
  hydrationEnabled: boolean;
  permissionsReady: Promise<void>;
  transactionRecovery: RestartRecovery;
  submittedTransactionMonitor: SubmittedTransactionMonitor;
  transactionRestartRecovery?: "run" | "skip";
  chainRpcBootstrap: ChainRpcBootstrap;
  sessionLayer: SessionLayerResult;
  logger: (message: string, error?: unknown) => void;
}): BackgroundLifecycleHandle => {
  const coreReadyPlugin: RuntimePlugin = {
    name: "coreReady",
    initialize: async () => {
      await hydrateCriticalStorage("chains", "chainDefinitions", () => stateServices.chainDefinitions.whenReady());
      await hydrateCriticalStorage("accounts", "accounts", () => stateServices.accounts.whenReady?.());
      await hydrateCriticalStorage("permissions", "permissions", () => permissionsReady);
      if (hydrationEnabled) {
        await hydrateCriticalStorage("chains", "providerChainSelection", () => providerChainSelection.loadAll());
      }
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

  const transactionMonitoringPlugin: RuntimePlugin = {
    name: "transactionMonitoring",
    initialize: async () => {
      try {
        await submittedTransactionMonitor.refresh();
      } catch (error) {
        throw new RuntimeHydrationError({
          owner: "transactions",
          resource: "submittedTransactionMonitor",
          cause: error,
        });
      }
    },
  };

  const chainRpcBootstrapPlugin: RuntimePlugin = {
    name: "chainRpcBootstrap",
    initialize: () => chainRpcBootstrap.loadPreferences(),
    hydrate: async () => {
      chainRpcBootstrap.requestSync();
    },
    afterHydration: () => chainRpcBootstrap.flushPendingSync(),
    start: () => chainRpcBootstrap.start(),
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

  const initializeOrder =
    transactionRestartRecovery === "skip"
      ? ([coreReadyPlugin, transactionMonitoringPlugin, chainRpcBootstrapPlugin] as const)
      : ([coreReadyPlugin, transactionRecoveryPlugin, transactionMonitoringPlugin, chainRpcBootstrapPlugin] as const);
  const hydrateOrder = [chainRpcBootstrapPlugin, sessionPlugin] as const;
  const afterHydrationOrder = [chainRpcBootstrapPlugin] as const;
  const startOrder = [chainRpcBootstrapPlugin, sessionPlugin] as const;
  const destroyOrder = [sessionPlugin, accountSelectionServicePlugin] as const;

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
