import { RpcInvalidRequestError } from "../../rpc/errors.js";
import type {
  CreateWalletFromMnemonicInput,
  GenerateMnemonicInput,
  RestoreWalletFromMnemonicInput,
  RestoreWalletFromPrivateKeyInput,
} from "../api.js";
import type { WalletApiContext } from "../context.js";
import { getSelectedWalletChainRefForNamespace } from "./chains.js";

const hasAnyOwnedAccounts = (context: WalletApiContext): boolean => {
  const state = context.accounts.getState();
  return Object.values(state.namespaces).some((namespace) => namespace.accountIds.length > 0);
};

const assertSetupUninitialized = (context: WalletApiContext): void => {
  const status = context.session.getStatus();
  if (status.status !== "uninitialized" || hasAnyOwnedAccounts(context)) {
    throw new RpcInvalidRequestError({ message: "Wallet is already initialized" });
  }
};

export const generateMnemonic = async (context: WalletApiContext, input?: GenerateMnemonicInput) => {
  const mnemonic = context.accounts.generateMnemonic(input?.wordCount ?? 12);
  return { words: mnemonic.split(" ") };
};

export const getWalletSetupStatus = (context: WalletApiContext) => context.setup.workflow.getStatus();

export const createWalletFromMnemonic = async (context: WalletApiContext, input: CreateWalletFromMnemonicInput) => {
  assertSetupUninitialized(context);
  const namespace = input.namespace ?? context.networks.getSelectedNamespace();
  return await context.setup.workflow.createWalletFromMnemonic({
    password: input.password,
    mnemonic: input.words.join(" "),
    ...(input.alias !== undefined ? { alias: input.alias } : {}),
    ...(input.skipBackup !== undefined ? { skipBackup: input.skipBackup } : {}),
    namespace,
    chainRef: getSelectedWalletChainRefForNamespace(context, namespace),
  });
};

export const restoreWalletFromMnemonic = async (context: WalletApiContext, input: RestoreWalletFromMnemonicInput) => {
  assertSetupUninitialized(context);
  const namespace = input.namespace ?? context.networks.getSelectedNamespace();
  return await context.setup.workflow.restoreWalletFromMnemonic({
    password: input.password,
    mnemonic: input.words.join(" "),
    ...(input.alias !== undefined ? { alias: input.alias } : {}),
    namespace,
    chainRef: getSelectedWalletChainRefForNamespace(context, namespace),
  });
};

export const restoreWalletFromPrivateKey = async (
  context: WalletApiContext,
  input: RestoreWalletFromPrivateKeyInput,
) => {
  assertSetupUninitialized(context);
  const namespace = input.namespace ?? context.networks.getSelectedNamespace();
  return await context.setup.workflow.restoreWalletFromPrivateKey({
    password: input.password,
    privateKey: input.privateKey,
    ...(input.alias !== undefined ? { alias: input.alias } : {}),
    namespace,
    chainRef: getSelectedWalletChainRefForNamespace(context, namespace),
  });
};
