import type { ChainRpcBootstrap } from "../../chains/bootstrap/chainRpcBootstrap.js";
import type { ProviderChainSelectionService } from "../../chains/selection/provider/types.js";
import type { SessionLayer } from "../../session/sessionLayer.js";
import { RuntimeHydrationError } from "../errors.js";
import type { BackgroundStateServices } from "./backgroundStateServices.js";
import type { RuntimeLifecycle } from "./runtimeLifecycle.js";
import { type RuntimePlugin, runPluginHooks, startPlugins } from "./runtimePlugins.js";

export type BackgroundLifecycleHandle = {
  initialize(): Promise<void>;
  start(): void;
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
  sessionLayer: SessionLayer;
}): BackgroundLifecycleHandle => {
  const coreReadyPlugin: RuntimePlugin = {
    name: "coreReady",
    initialize: async () => {
      await hydrateCriticalStorage("chains", "chainDefinitions", () => stateServices.chainDefinitions.whenReady());
      await hydrateCriticalStorage("accounts", "accounts", () => stateServices.accounts.whenReady?.());
      await hydrateCriticalStorage("permissions", "permissions", () => permissionsReady);
      await hydrateCriticalStorage("keyring", "keyrings", () => sessionLayer.attachKeyring());
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
          if (failed.error) {
            throw failed.error;
          }
          throw new RuntimeHydrationError({
            owner: "transactions",
            resource: "restartRecovery",
            cause: { actionKind: failed.action.kind },
          });
        }
      } catch (error) {
        if (error instanceof RuntimeHydrationError) {
          throw error;
        }
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
    initialize: () => chainRpcBootstrap.loadStoredChainState(),
    hydrate: async () => {
      chainRpcBootstrap.refreshChainRpcAccesses();
    },
    afterHydration: () => chainRpcBootstrap.cleanStoredChainState(),
    start: () => chainRpcBootstrap.start(),
  };

  const sessionPlugin: RuntimePlugin = {
    name: "sessionLayer",
    hydrate: () => sessionLayer.hydrateVaultMeta(),
    start: () => sessionLayer.attachSessionListeners(),
  };

  const initializeOrder =
    transactionRestartRecovery === "skip"
      ? ([coreReadyPlugin, transactionMonitoringPlugin, chainRpcBootstrapPlugin] as const)
      : ([coreReadyPlugin, transactionRecoveryPlugin, transactionMonitoringPlugin, chainRpcBootstrapPlugin] as const);
  const hydrateOrder = [chainRpcBootstrapPlugin, sessionPlugin] as const;
  const afterHydrationOrder = [chainRpcBootstrapPlugin] as const;
  const startOrder = [chainRpcBootstrapPlugin, sessionPlugin] as const;

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
    getIsInitialized: () => runtimeLifecycle.getIsInitialized(),
  };
};
