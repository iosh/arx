import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { z } from "zod";
import { KeyringInvalidMnemonicError, KeyringInvalidPrivateKeyError } from "../../keyring/errors.js";
import { RpcInvalidRequestError } from "../../rpc/errors.js";
import type {
  ConfirmNewMnemonicParams,
  ImportMnemonicParams,
  ImportPrivateKeyParams,
} from "../../runtime/keyring/KeyringService.js";
import type {
  CreateWalletFromMnemonicInput,
  GenerateMnemonicInput,
  ImportWalletFromMnemonicInput,
  ImportWalletFromPrivateKeyInput,
} from "../api.js";
import type { WalletApiContext } from "../context.js";
import { WalletApiSharedSchemas } from "../schemas/shared.js";
import { selectCreatedAccount } from "./createdAccountSelection.js";

export const WalletApiOnboardingSchemas = {
  generateMnemonic: z
    .strictObject({
      wordCount: z.union([z.literal(12), z.literal(24)]).optional(),
    })
    .optional(),
  createWalletFromMnemonic: z.strictObject({
    password: WalletApiSharedSchemas.password,
    words: WalletApiSharedSchemas.mnemonicWords,
    alias: z.string().min(1).optional(),
    skipBackup: z.boolean().optional(),
    namespace: z.string().min(1).optional(),
  }),
  importWalletFromMnemonic: z.strictObject({
    password: WalletApiSharedSchemas.password,
    words: WalletApiSharedSchemas.mnemonicWords,
    alias: z.string().min(1).optional(),
    namespace: z.string().min(1).optional(),
  }),
  importWalletFromPrivateKey: z.strictObject({
    password: WalletApiSharedSchemas.password,
    privateKey: z.string().min(1),
    alias: z.string().min(1).optional(),
    namespace: z.string().min(1).optional(),
  }),
} satisfies Record<string, z.ZodTypeAny>;

const sanitizeMnemonicPhraseFromWords = (words: readonly string[]): string =>
  words
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean)
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");

const validateBip39Mnemonic = (mnemonic: string): void => {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new KeyringInvalidMnemonicError();
  }
};

const parsePrivateKeyHex = (value: string): string => {
  const trimmed = value.trim();
  const privateKeyHexWithPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKeyHexWithPrefix)) {
    throw new KeyringInvalidPrivateKeyError();
  }
  return privateKeyHexWithPrefix;
};

const hasAnyOwnedAccounts = (context: WalletApiContext): boolean => {
  const state = context.accounts.getState();
  return Object.values(state.namespaces).some((namespace) => namespace.accountKeys.length > 0);
};

const runWalletSetupFlow = async <T>(
  context: WalletApiContext,
  password: string,
  run: () => Promise<T>,
): Promise<T> => {
  return await context.session.withVaultMetaPersistHold(async () => {
    const status = context.session.getStatus();
    if (status.status !== "uninitialized" && hasAnyOwnedAccounts(context)) {
      throw new RpcInvalidRequestError({ message: "Vault already initialized" });
    }

    if (status.status === "uninitialized") {
      await context.session.createVault({ password });
      await context.session.unlock({ password });
    } else if (!context.session.isUnlocked()) {
      await context.session.unlock({ password });
    }

    return await run();
  });
};

export const generateMnemonic = async (context: WalletApiContext, input?: GenerateMnemonicInput) => {
  const params = WalletApiOnboardingSchemas.generateMnemonic.parse(input);
  const mnemonic = context.accounts.generateMnemonic(params?.wordCount ?? 12);
  return { words: mnemonic.split(" ") };
};

export const createWalletFromMnemonic = async (context: WalletApiContext, input: CreateWalletFromMnemonicInput) => {
  const params = WalletApiOnboardingSchemas.createWalletFromMnemonic.parse(input);
  const mnemonic = sanitizeMnemonicPhraseFromWords(params.words);
  validateBip39Mnemonic(mnemonic);
  const command: ConfirmNewMnemonicParams = { mnemonic };
  if (params.alias !== undefined) {
    command.alias = params.alias;
  }
  if (params.skipBackup !== undefined) {
    command.skipBackup = params.skipBackup;
  }
  if (params.namespace !== undefined) {
    command.namespace = params.namespace;
  }

  const result = await runWalletSetupFlow(context, params.password, async () => {
    return await context.accounts.confirmNewMnemonic(command);
  });
  const namespace = command.namespace ?? context.networks.getSelectedNamespace();
  await selectCreatedAccount(context, { namespace, address: result.address });
  return result;
};

export const importWalletFromMnemonic = async (context: WalletApiContext, input: ImportWalletFromMnemonicInput) => {
  const params = WalletApiOnboardingSchemas.importWalletFromMnemonic.parse(input);
  const mnemonic = sanitizeMnemonicPhraseFromWords(params.words);
  validateBip39Mnemonic(mnemonic);
  const command: ImportMnemonicParams = { mnemonic };
  if (params.alias !== undefined) {
    command.alias = params.alias;
  }
  if (params.namespace !== undefined) {
    command.namespace = params.namespace;
  }

  const result = await runWalletSetupFlow(context, params.password, async () => {
    return await context.accounts.importMnemonic(command);
  });
  const namespace = command.namespace ?? context.networks.getSelectedNamespace();
  await selectCreatedAccount(context, { namespace, address: result.address });
  return result;
};

export const importWalletFromPrivateKey = async (context: WalletApiContext, input: ImportWalletFromPrivateKeyInput) => {
  const params = WalletApiOnboardingSchemas.importWalletFromPrivateKey.parse(input);
  const privateKey = parsePrivateKeyHex(params.privateKey);
  const command: ImportPrivateKeyParams = { privateKey };
  if (params.alias !== undefined) {
    command.alias = params.alias;
  }
  if (params.namespace !== undefined) {
    command.namespace = params.namespace;
  }

  const result = await runWalletSetupFlow(context, params.password, async () => {
    return await context.accounts.importPrivateKey(command);
  });
  const namespace = command.namespace ?? context.networks.getSelectedNamespace();
  await selectCreatedAccount(context, { namespace, address: result.account.address });
  return result;
};
