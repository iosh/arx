import type { WalletAccounts, WalletNetworks, WalletSession } from "../../engine/types.js";
import { RpcInvalidRequestError } from "../../rpc/errors.js";
import type {
  CreateWalletFromMnemonicInput,
  GenerateMnemonicInput,
  RestoreWalletFromMnemonicInput,
  RestoreWalletFromPrivateKeyInput,
} from "../api.js";
import { getSelectedWalletChainRefForNamespace } from "./chains.js";
import type { WalletSetupWorkflow } from "./setupWorkflow.js";

type SetupHandlersDeps = {
  session: Pick<WalletSession, "getStatus">;
  accounts: Pick<WalletAccounts, "generateMnemonic" | "getState">;
  networks: Pick<WalletNetworks, "getSelectedNamespace" | "getSelectedChainRef" | "getActiveChainViewForNamespace">;
  setupWorkflow: WalletSetupWorkflow;
};

const hasAnyOwnedAccounts = (accounts: Pick<WalletAccounts, "getState">): boolean => {
  const state = accounts.getState();
  return Object.values(state.namespaces).some((namespace) => (namespace?.accountIds.length ?? 0) > 0);
};

const assertSetupUninitialized = (deps: SetupHandlersDeps): void => {
  const status = deps.session.getStatus();
  if (status.status !== "uninitialized" || hasAnyOwnedAccounts(deps.accounts)) {
    throw new RpcInvalidRequestError({ message: "Wallet is already initialized" });
  }
};

export const createSetupHandlers = (deps: SetupHandlersDeps) => ({
  getStatus: () => deps.setupWorkflow.getStatus(),
  generateMnemonic: async (input?: GenerateMnemonicInput) => {
    const mnemonic = deps.accounts.generateMnemonic(input?.wordCount ?? 12);
    return { words: mnemonic.split(" ") };
  },
  createWalletFromMnemonic: async (input: CreateWalletFromMnemonicInput) => {
    assertSetupUninitialized(deps);
    const namespace = input.namespace ?? deps.networks.getSelectedNamespace();
    return await deps.setupWorkflow.createWalletFromMnemonic({
      password: input.password,
      mnemonic: input.words.join(" "),
      ...(input.alias !== undefined ? { alias: input.alias } : {}),
      ...(input.skipBackup !== undefined ? { skipBackup: input.skipBackup } : {}),
      namespace,
      chainRef: getSelectedWalletChainRefForNamespace(deps.networks, namespace),
    });
  },
  restoreWalletFromMnemonic: async (input: RestoreWalletFromMnemonicInput) => {
    assertSetupUninitialized(deps);
    const namespace = input.namespace ?? deps.networks.getSelectedNamespace();
    return await deps.setupWorkflow.restoreWalletFromMnemonic({
      password: input.password,
      mnemonic: input.words.join(" "),
      ...(input.alias !== undefined ? { alias: input.alias } : {}),
      namespace,
      chainRef: getSelectedWalletChainRefForNamespace(deps.networks, namespace),
    });
  },
  restoreWalletFromPrivateKey: async (input: RestoreWalletFromPrivateKeyInput) => {
    assertSetupUninitialized(deps);
    const namespace = input.namespace ?? deps.networks.getSelectedNamespace();
    return await deps.setupWorkflow.restoreWalletFromPrivateKey({
      password: input.password,
      privateKey: input.privateKey,
      ...(input.alias !== undefined ? { alias: input.alias } : {}),
      namespace,
      chainRef: getSelectedWalletChainRefForNamespace(deps.networks, namespace),
    });
  },
});
