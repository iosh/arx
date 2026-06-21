import type { CoreRuntime, CreateCoreRuntimeInput } from "./coreRuntime.js";
import { type CreateArxWalletRuntimeInput, createArxWalletRuntime } from "./createArxWallet.js";

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

export const createCoreRuntimeFromArxWalletRuntime = (
  runtime: Awaited<ReturnType<typeof createArxWalletRuntime>>,
): CoreRuntime => {
  return {
    provider: runtime.provider,
    wallet: runtime.walletApi,
  };
};

export const createCoreRuntime = async (input: CreateCoreRuntimeInput): Promise<CoreRuntime> => {
  const runtime = await createArxWalletRuntime(buildArxWalletRuntimeInput(input));
  return createCoreRuntimeFromArxWalletRuntime(runtime);
};
