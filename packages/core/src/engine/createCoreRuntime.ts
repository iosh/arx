import type { CoreRuntime, CreateCoreRuntimeInput } from "./coreRuntime.js";
import { type CreateArxWalletRuntimeInput, createArxWalletRuntime } from "./createArxWallet.js";

type ArxWalletStorageInput = CreateArxWalletRuntimeInput["storage"];
type ArxWalletRuntimeOptions = NonNullable<CreateArxWalletRuntimeInput["runtime"]>;

type MutableArxWalletStorageInput = {
  ports: ArxWalletStorageInput["ports"];
  hydrate?: NonNullable<ArxWalletStorageInput["hydrate"]>;
};

type MutableArxWalletRuntimeInput = {
  namespaces: CreateArxWalletRuntimeInput["namespaces"];
  storage: ArxWalletStorageInput;
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
