import { createRpcRegistry } from "../rpc/index.js";
import { createBackgroundRuntimeLifecycle } from "../runtime/background/runtimeLifecyclePlan.js";
import {
  initializeRuntimeBootstrapPhase,
  initializeRuntimeSessionPhase,
  initializeRuntimeSupportPhase,
} from "../runtime/background/runtimePhases.js";
import { assembleRuntimeNamespaceStagesFromWalletModules } from "./modules/manifestInterop.js";
import { createWalletNamespaces } from "./namespaces.js";
import type { ArxWallet, CreateArxWalletInput } from "./types.js";

const buildStorageOptions = (
  input: CreateArxWalletInput,
): { now?: () => number; logger?: (message: string, error?: unknown) => void; hydrate?: boolean } | undefined => {
  const storageOptions: {
    now?: () => number;
    logger?: (message: string, error?: unknown) => void;
    hydrate?: boolean;
  } = {};

  if (input.env?.now) {
    storageOptions.now = input.env.now;
  }
  if (input.env?.logger) {
    storageOptions.logger = input.env.logger;
  }
  if (input.storage.hydrate !== undefined) {
    storageOptions.hydrate = input.storage.hydrate;
  }

  return Object.keys(storageOptions).length > 0 ? storageOptions : undefined;
};

const bootWalletLifecycle = async (
  lifecycle: Pick<ReturnType<typeof createBackgroundRuntimeLifecycle>, "initialize" | "start">,
): Promise<void> => {
  await lifecycle.initialize();
  lifecycle.start();
};

export const createArxWallet = async (input: CreateArxWalletInput): Promise<ArxWallet> => {
  const modules = input.namespaces.modules;
  if (modules.length === 0) {
    throw new Error("createArxWallet requires at least one wallet namespace module");
  }

  const rpcRegistry = createRpcRegistry();
  const namespacesDestroyedState = {
    value: false,
  };
  const namespaces = createWalletNamespaces({
    modules,
    getIsDestroyed: () => namespacesDestroyedState.value,
  });
  const namespaceStages = assembleRuntimeNamespaceStagesFromWalletModules(namespaces.listModules());
  const storageOptions = buildStorageOptions(input);

  const bootstrapPhase = initializeRuntimeBootstrapPhase({
    rpcRegistry,
    namespaceBootstrap: namespaceStages.bootstrap,
    ...(storageOptions ? { storageOptions } : {}),
    chainDefinitionsOptions: {
      port: input.storage.ports.chainDefinitions,
    },
  });

  const sessionPhase = initializeRuntimeSessionPhase({
    lifecycleLabel: "createArxWallet",
    bootstrapPhase,
    namespaceSession: namespaceStages.session,
    settingsPort: input.storage.ports.settings,
    networkPreferencesPort: input.storage.ports.networkPreferences,
    storePorts: {
      accounts: input.storage.ports.accounts,
      keyringMetas: input.storage.ports.keyringMetas,
      permissions: input.storage.ports.permissions,
      transactions: input.storage.ports.transactions,
    },
    ...(input.storage.vaultMetaPort ? { vaultMetaPort: input.storage.vaultMetaPort } : {}),
    ...(input.env?.randomUuid ? { sessionOptions: { uuid: input.env.randomUuid } } : {}),
  });

  const runtimeSupportPhase = initializeRuntimeSupportPhase({
    bootstrapPhase,
    sessionPhase,
    namespaceRuntimeSupport: namespaceStages.runtimeSupport,
  });

  const lifecycle = createBackgroundRuntimeLifecycle({
    runtimeLifecycle: sessionPhase.runtimeLifecycle,
    controllersBase: sessionPhase.controllersBase,
    deferredNetworkInitialState: sessionPhase.deferredNetworkInitialState,
    registeredNamespaces: bootstrapPhase.registeredNamespaces,
    transactionsLifecycle: runtimeSupportPhase.transactionsLifecycle,
    networkBootstrap: runtimeSupportPhase.networkBootstrap,
    sessionLayer: sessionPhase.sessionLayer,
    rpcClientRegistry: runtimeSupportPhase.rpcClientRegistry,
    engine: sessionPhase.engine,
    bus: bootstrapPhase.bus,
    logger: bootstrapPhase.storageLogger,
  });

  const wallet: ArxWallet = {
    namespaces,
    destroy: async () => {
      namespacesDestroyedState.value = true;
      lifecycle.destroy();
    },
  };

  try {
    await bootWalletLifecycle(lifecycle);
    return wallet;
  } catch (error) {
    await wallet.destroy();
    throw error;
  }
};
