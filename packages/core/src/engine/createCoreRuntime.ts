import { ATTENTION_STATE_CHANGED } from "../services/runtime/attention/index.js";
import type { UiPlatformAdapter } from "../ui/server/types.js";
import type {
  CoreReadApi,
  CoreRuntime,
  CoreUnsubscribe,
  CoreWalletUiApi,
  CreateCoreRuntimeInput,
} from "./coreRuntime.js";
import { type CreateArxWalletRuntimeInput, createArxWalletRuntime } from "./createArxWallet.js";
import type { WalletUi } from "./types.js";

const CORE_UI_ORIGIN = "arx://core-ui";

const CORE_UI_NO_HOST_PLATFORM: UiPlatformAdapter = {
  openOnboardingTab: async () => ({ activationPath: "debounced" }),
  openNotificationPopup: async () => ({ activationPath: "debounced" }),
};

type ArxWalletStorageInput = CreateArxWalletRuntimeInput["storage"];
type ArxWalletEnvironmentInput = NonNullable<CreateArxWalletRuntimeInput["env"]>;
type ArxWalletRuntimeOptions = NonNullable<CreateArxWalletRuntimeInput["runtime"]>;

type MutableArxWalletStorageInput = {
  ports: ArxWalletStorageInput["ports"];
  hydrate?: NonNullable<ArxWalletStorageInput["hydrate"]>;
};

type MutableArxWalletEnvironmentInput = {
  now?: NonNullable<ArxWalletEnvironmentInput["now"]>;
  logger?: NonNullable<ArxWalletEnvironmentInput["logger"]>;
  randomUuid?: NonNullable<ArxWalletEnvironmentInput["randomUuid"]>;
};

type MutableArxWalletRuntimeInput = {
  namespaces: CreateArxWalletRuntimeInput["namespaces"];
  storage: ArxWalletStorageInput;
  env?: ArxWalletEnvironmentInput;
  runtime: ArxWalletRuntimeOptions;
};

type CoreReadStateSubscription = (listener: () => void) => CoreUnsubscribe;

const buildArxWalletStorageInput = (input: CreateCoreRuntimeInput): ArxWalletStorageInput => {
  const storage: MutableArxWalletStorageInput = {
    ports: input.storage,
  };

  if (input.boot?.hydrate !== undefined) {
    storage.hydrate = input.boot.hydrate;
  }

  return storage;
};

const buildArxWalletEnvironmentInput = (
  environment: CreateCoreRuntimeInput["environment"],
): ArxWalletEnvironmentInput | undefined => {
  if (!environment) {
    return undefined;
  }

  const env: MutableArxWalletEnvironmentInput = {};

  if (environment.now) {
    env.now = environment.now;
  }
  if (environment.logger) {
    env.logger = environment.logger;
  }
  if (environment.createId) {
    env.randomUuid = environment.createId;
  }

  return Object.keys(env).length > 0 ? env : undefined;
};

const buildArxWalletRuntimeOptions = (boot: CreateCoreRuntimeInput["boot"]): ArxWalletRuntimeOptions => ({
  lifecycleLabel: "createCoreRuntime",
  transactionRestartRecovery: boot?.transactionRestartRecovery ?? "run",
});

const buildArxWalletRuntimeInput = (input: CreateCoreRuntimeInput): CreateArxWalletRuntimeInput => {
  const runtimeInput: MutableArxWalletRuntimeInput = {
    namespaces: input.namespaces,
    storage: buildArxWalletStorageInput(input),
    runtime: buildArxWalletRuntimeOptions(input.boot),
  };
  const environment = buildArxWalletEnvironmentInput(input.environment);

  if (environment) {
    runtimeInput.env = environment;
  }

  return runtimeInput;
};

const subscribeReadChanges = (
  runtime: Awaited<ReturnType<typeof createArxWalletRuntime>>,
): CoreReadApi["subscribe"] => {
  const subscribeAfterInitialReplay = (subscribe: CoreReadStateSubscription, listener: () => void) => {
    let replayingSnapshot = true;
    const unsubscribe = subscribe(() => {
      if (replayingSnapshot) {
        return;
      }
      listener();
    });
    replayingSnapshot = false;
    return unsubscribe;
  };

  return (listener) => {
    const notify = () => listener();
    const unsubscribers: CoreUnsubscribe[] = [
      subscribeAfterInitialReplay((handler) => runtime.services.accounts.onStateChanged(handler), notify),
      subscribeAfterInitialReplay((handler) => runtime.services.permissions.onStateChanged(handler), notify),
      subscribeAfterInitialReplay((handler) => runtime.services.chainRpc.onStateChanged(handler), notify),
      runtime.services.walletChainSelection.subscribeChanged(notify),
      runtime.services.session.onStateChanged(notify),
      runtime.bus.subscribe(ATTENTION_STATE_CHANGED, notify),
      runtime.transactions.onTransactionsChanged(notify),
      runtime.transactions.onTransactionApprovalsChanged(notify),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  };
};

const createCoreReadApi = (runtime: Awaited<ReturnType<typeof createArxWalletRuntime>>): CoreReadApi => ({
  getWalletSnapshot: () => runtime.wallet.snapshots.buildUiSnapshot(),
  subscribe: subscribeReadChanges(runtime),
});

const createCoreWalletUiApi = (ui: WalletUi): CoreWalletUiApi => ({
  session: {
    unlock: (input) => ui.dispatch({ method: "ui.session.unlock", params: input }),
    lock: (input) => ui.dispatch({ method: "ui.session.lock", params: input }),
    resetAutoLockTimer: () => ui.dispatch({ method: "ui.session.resetAutoLockTimer" }),
    setAutoLockDuration: (input) => ui.dispatch({ method: "ui.session.setAutoLockDuration", params: input }),
  },
  wallet: {
    generateMnemonic: (input) => ui.dispatch({ method: "ui.onboarding.generateMnemonic", params: input }),
    createWalletFromMnemonic: (input) =>
      ui.dispatch({ method: "ui.onboarding.createWalletFromMnemonic", params: input }),
    importWalletFromMnemonic: (input) =>
      ui.dispatch({ method: "ui.onboarding.importWalletFromMnemonic", params: input }),
    importWalletFromPrivateKey: (input) =>
      ui.dispatch({ method: "ui.onboarding.importWalletFromPrivateKey", params: input }),
  },
  accounts: {
    switchActive: (input) => ui.dispatch({ method: "ui.accounts.switchActive", params: input }),
  },
  chains: {
    selectWalletChain: (input) => ui.dispatch({ method: "ui.networks.switchActive", params: input }),
  },
  approvals: {
    resolve: (input) => ui.dispatch({ method: "ui.approvals.resolve", params: input }),
  },
  keyrings: {
    confirmNewMnemonic: (input) => ui.dispatch({ method: "ui.keyrings.confirmNewMnemonic", params: input }),
    importMnemonic: (input) => ui.dispatch({ method: "ui.keyrings.importMnemonic", params: input }),
    importPrivateKey: (input) => ui.dispatch({ method: "ui.keyrings.importPrivateKey", params: input }),
    deriveAccount: (input) => ui.dispatch({ method: "ui.keyrings.deriveAccount", params: input }),
    list: () => ui.dispatch({ method: "ui.keyrings.list" }),
    getAccountsByKeyring: (input) => ui.dispatch({ method: "ui.keyrings.getAccountsByKeyring", params: input }),
    renameKeyring: (input) => ui.dispatch({ method: "ui.keyrings.renameKeyring", params: input }),
    renameAccount: (input) => ui.dispatch({ method: "ui.keyrings.renameAccount", params: input }),
    markBackedUp: (input) => ui.dispatch({ method: "ui.keyrings.markBackedUp", params: input }),
    hideHdAccount: (input) => ui.dispatch({ method: "ui.keyrings.hideHdAccount", params: input }),
    unhideHdAccount: (input) => ui.dispatch({ method: "ui.keyrings.unhideHdAccount", params: input }),
    removePrivateKeyKeyring: (input) => ui.dispatch({ method: "ui.keyrings.removePrivateKeyKeyring", params: input }),
    exportMnemonic: (input) => ui.dispatch({ method: "ui.keyrings.exportMnemonic", params: input }),
    exportPrivateKey: (input) => ui.dispatch({ method: "ui.keyrings.exportPrivateKey", params: input }),
  },
  transactions: {
    requestSendTransactionApproval: (input) =>
      ui.dispatch({ method: "ui.transactions.requestSendTransactionApproval", params: input }),
    rerunPrepare: (input) => ui.dispatch({ method: "ui.transactions.rerunPrepare", params: input }),
    applyDraftEdit: (input) => ui.dispatch({ method: "ui.transactions.applyDraftEdit", params: input }),
  },
});

export const createCoreRuntimeFromArxWalletRuntime = (
  runtime: Awaited<ReturnType<typeof createArxWalletRuntime>>,
): CoreRuntime => {
  const ui = runtime.wallet.createUi({
    platform: CORE_UI_NO_HOST_PLATFORM,
    uiOrigin: CORE_UI_ORIGIN,
  });

  return {
    provider: runtime.provider,
    ui: createCoreWalletUiApi(ui),
    read: createCoreReadApi(runtime),
  };
};

export const createCoreRuntime = async (input: CreateCoreRuntimeInput): Promise<CoreRuntime> => {
  const runtime = await createArxWalletRuntime(buildArxWalletRuntimeInput(input));
  return createCoreRuntimeFromArxWalletRuntime(runtime);
};
