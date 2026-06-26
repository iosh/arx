import { getAccountKeyNamespace } from "../../accounts/addressing/accountKey.js";
import { PermissionDeniedError } from "../../permissions/errors.js";
import type {
  ConfirmNewMnemonicParams,
  ImportMnemonicParams,
  ImportPrivateKeyParams,
} from "../../runtime/keyring/KeyringService.js";
import type { AccountRecord, KeyringMetaRecord } from "../../storage/records.js";
import type {
  ConfirmNewMnemonicInput,
  DeriveAccountInput,
  ExportMnemonicInput,
  ExportPrivateKeyInput,
  HideHdAccountInput,
  ImportMnemonicInput,
  ImportPrivateKeyInput,
  MarkBackedUpInput,
  RemovePrivateKeyKeyringInput,
  RenameAccountInput,
  RenameKeyringInput,
  UnhideHdAccountInput,
  WalletApiAccountsByKeyringInput,
} from "../api.js";
import type { WalletApiContext } from "../context.js";
import type { AccountMeta, KeyringMeta } from "../types.js";
import { getSelectedWalletChainRefForNamespace } from "./chains.js";
import { selectCreatedAccount } from "./createdAccountSelection.js";
import { assertSessionUnlocked } from "./session.js";

const privateKeyBytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const buildKeyringMetaFromRecord = (record: KeyringMetaRecord): KeyringMeta => ({
  id: record.id,
  type: record.type,
  createdAt: record.createdAt,
  ...(record.alias !== undefined ? { alias: record.alias } : {}),
  ...(record.type === "hd"
    ? { backedUp: record.needsBackup !== true, derivedCount: record.nextDerivationIndex ?? 0 }
    : {}),
});

const buildAccountMetaFromRecord = (context: WalletApiContext, record: AccountRecord): AccountMeta => ({
  accountKey: record.accountKey,
  canonicalAddress: context.accountCodecs.toCanonicalAddressFromAccountKey({
    accountKey: record.accountKey,
  }),
  keyringId: record.keyringId,
  createdAt: record.createdAt,
  ...(record.derivationIndex !== undefined ? { derivationIndex: record.derivationIndex } : {}),
  ...(record.alias !== undefined ? { alias: record.alias } : {}),
  ...(record.hidden !== undefined ? { hidden: record.hidden } : {}),
});

export const listKeyrings = (context: WalletApiContext) =>
  context.accounts.getKeyrings().map(buildKeyringMetaFromRecord);

export const getAccountsByKeyring = (context: WalletApiContext, input: WalletApiAccountsByKeyringInput) => {
  return context.accounts
    .getAccountsByKeyring(input.keyringId, input.includeHidden ?? false)
    .map((record) => buildAccountMetaFromRecord(context, record));
};

export const getBackupStatus = (context: WalletApiContext) => context.accounts.getBackupStatus();

export const confirmNewMnemonic = async (context: WalletApiContext, input: ConfirmNewMnemonicInput) => {
  assertSessionUnlocked(context);
  const command: ConfirmNewMnemonicParams = {
    mnemonic: input.words.join(" "),
  };
  if (input.alias !== undefined) {
    command.alias = input.alias;
  }
  if (input.skipBackup !== undefined) {
    command.skipBackup = input.skipBackup;
  }
  if (input.namespace !== undefined) {
    command.namespace = input.namespace;
  }

  const result = await context.accounts.confirmNewMnemonic(command);
  const selection: { address: string; namespace?: string } = { address: result.address };
  if (command.namespace !== undefined) {
    selection.namespace = command.namespace;
  }
  await selectCreatedAccount(context, selection);
  return result;
};

export const importMnemonic = async (context: WalletApiContext, input: ImportMnemonicInput) => {
  assertSessionUnlocked(context);
  const command: ImportMnemonicParams = {
    mnemonic: input.words.join(" "),
  };
  if (input.alias !== undefined) {
    command.alias = input.alias;
  }
  if (input.namespace !== undefined) {
    command.namespace = input.namespace;
  }

  const result = await context.accounts.importMnemonic(command);
  const selection: { address: string; namespace?: string } = { address: result.address };
  if (command.namespace !== undefined) {
    selection.namespace = command.namespace;
  }
  await selectCreatedAccount(context, selection);
  return result;
};

export const importPrivateKey = async (context: WalletApiContext, input: ImportPrivateKeyInput) => {
  assertSessionUnlocked(context);
  const command: ImportPrivateKeyParams = {
    privateKey: input.privateKey,
  };
  if (input.alias !== undefined) {
    command.alias = input.alias;
  }
  if (input.namespace !== undefined) {
    command.namespace = input.namespace;
  }

  const result = await context.accounts.importPrivateKey(command);
  const selection: { address: string; namespace?: string } = { address: result.account.address };
  if (command.namespace !== undefined) {
    selection.namespace = command.namespace;
  }
  await selectCreatedAccount(context, selection);
  return result;
};

export const deriveAccount = async (context: WalletApiContext, input: DeriveAccountInput) => {
  assertSessionUnlocked(context);
  return await context.accounts.deriveAccount(input.keyringId);
};

export const renameKeyring = async (context: WalletApiContext, input: RenameKeyringInput) => {
  assertSessionUnlocked(context);
  await context.accounts.renameKeyring(input.keyringId, input.alias);
  return null;
};

export const renameAccount = async (context: WalletApiContext, input: RenameAccountInput) => {
  assertSessionUnlocked(context);
  await context.accounts.renameAccount(input.accountKey, input.alias);
  return null;
};

export const markBackedUp = async (context: WalletApiContext, input: MarkBackedUpInput) => {
  assertSessionUnlocked(context);
  await context.accounts.markBackedUp(input.keyringId);
  return null;
};

export const hideHdAccount = async (context: WalletApiContext, input: HideHdAccountInput) => {
  assertSessionUnlocked(context);
  const namespace = getAccountKeyNamespace(input.accountKey);
  const chainRef = getSelectedWalletChainRefForNamespace(context, namespace);
  const activeAccount = context.accounts.getActiveAccountForNamespace({ namespace, chainRef });
  if (activeAccount?.accountKey === input.accountKey) {
    throw new PermissionDeniedError();
  }
  await context.accounts.hideHdAccount(input.accountKey);
  return null;
};

export const unhideHdAccount = async (context: WalletApiContext, input: UnhideHdAccountInput) => {
  assertSessionUnlocked(context);
  await context.accounts.unhideHdAccount(input.accountKey);
  return null;
};

export const removePrivateKeyKeyring = async (context: WalletApiContext, input: RemovePrivateKeyKeyringInput) => {
  assertSessionUnlocked(context);
  await context.accounts.removePrivateKeyKeyring(input.keyringId);
  return null;
};

export const exportMnemonic = async (context: WalletApiContext, input: ExportMnemonicInput) => {
  return { words: (await context.accounts.exportMnemonic(input.keyringId, input.password)).split(" ") };
};

export const exportPrivateKey = async (context: WalletApiContext, input: ExportPrivateKeyInput) => {
  const secret = await context.accounts.exportPrivateKeyByAccountKey(input.accountKey, input.password);
  return { privateKey: privateKeyBytesToHex(secret) };
};
