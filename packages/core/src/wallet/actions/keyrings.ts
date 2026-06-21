import { getAccountKeyNamespace } from "../../accounts/addressing/accountKey.js";
import { PermissionDeniedError } from "../../permissions/errors.js";
import type {
  ConfirmNewMnemonicParams,
  ImportMnemonicParams,
  ImportPrivateKeyParams,
} from "../../runtime/keyring/KeyringService.js";
import type { AccountRecord, KeyringMetaRecord } from "../../storage/records.js";
import type { UiAccountMeta, UiKeyringMeta } from "../../ui/protocol/schemas.js";
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
import { WalletApiKeyringsSchemas } from "../schemas/keyrings.js";
import { getSelectedWalletChainRefForNamespace } from "./chains.js";
import { selectCreatedAccount } from "./createdAccountSelection.js";
import { assertSessionUnlocked } from "./session.js";

const privateKeyBytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const buildKeyringMetaFromRecord = (record: KeyringMetaRecord): UiKeyringMeta => ({
  id: record.id,
  type: record.type,
  createdAt: record.createdAt,
  ...(record.alias !== undefined ? { alias: record.alias } : {}),
  ...(record.type === "hd"
    ? { backedUp: record.needsBackup !== true, derivedCount: record.nextDerivationIndex ?? 0 }
    : {}),
});

const buildAccountMetaFromRecord = (context: WalletApiContext, record: AccountRecord): UiAccountMeta => ({
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
  const params = WalletApiKeyringsSchemas.getAccountsByKeyring.parse(input);
  return context.accounts
    .getAccountsByKeyring(params.keyringId, params.includeHidden ?? false)
    .map((record) => buildAccountMetaFromRecord(context, record));
};

export const getBackupStatus = (context: WalletApiContext) => context.accounts.getBackupStatus();

export const confirmNewMnemonic = async (context: WalletApiContext, input: ConfirmNewMnemonicInput) => {
  assertSessionUnlocked(context);
  const params = WalletApiKeyringsSchemas.confirmNewMnemonic.parse(input);
  const command: ConfirmNewMnemonicParams = {
    mnemonic: params.words.join(" "),
  };
  if (params.alias !== undefined) {
    command.alias = params.alias;
  }
  if (params.skipBackup !== undefined) {
    command.skipBackup = params.skipBackup;
  }
  if (params.namespace !== undefined) {
    command.namespace = params.namespace;
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
  const params = WalletApiKeyringsSchemas.importMnemonic.parse(input);
  const command: ImportMnemonicParams = {
    mnemonic: params.words.join(" "),
  };
  if (params.alias !== undefined) {
    command.alias = params.alias;
  }
  if (params.namespace !== undefined) {
    command.namespace = params.namespace;
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
  const params = WalletApiKeyringsSchemas.importPrivateKey.parse(input);
  const command: ImportPrivateKeyParams = {
    privateKey: params.privateKey,
  };
  if (params.alias !== undefined) {
    command.alias = params.alias;
  }
  if (params.namespace !== undefined) {
    command.namespace = params.namespace;
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
  const params = WalletApiKeyringsSchemas.deriveAccount.parse(input);
  return await context.accounts.deriveAccount(params.keyringId);
};

export const renameKeyring = async (context: WalletApiContext, input: RenameKeyringInput) => {
  assertSessionUnlocked(context);
  const params = WalletApiKeyringsSchemas.renameKeyring.parse(input);
  await context.accounts.renameKeyring(params.keyringId, params.alias);
  return null;
};

export const renameAccount = async (context: WalletApiContext, input: RenameAccountInput) => {
  assertSessionUnlocked(context);
  const params = WalletApiKeyringsSchemas.renameAccount.parse(input);
  await context.accounts.renameAccount(params.accountKey, params.alias);
  return null;
};

export const markBackedUp = async (context: WalletApiContext, input: MarkBackedUpInput) => {
  assertSessionUnlocked(context);
  const params = WalletApiKeyringsSchemas.markBackedUp.parse(input);
  await context.accounts.markBackedUp(params.keyringId);
  return null;
};

export const hideHdAccount = async (context: WalletApiContext, input: HideHdAccountInput) => {
  assertSessionUnlocked(context);
  const params = WalletApiKeyringsSchemas.hideHdAccount.parse(input);
  const namespace = getAccountKeyNamespace(params.accountKey);
  const chainRef = getSelectedWalletChainRefForNamespace(context, namespace);
  const activeAccount = context.accounts.getActiveAccountForNamespace({ namespace, chainRef });
  if (activeAccount?.accountKey === params.accountKey) {
    throw new PermissionDeniedError();
  }
  await context.accounts.hideHdAccount(params.accountKey);
  return null;
};

export const unhideHdAccount = async (context: WalletApiContext, input: UnhideHdAccountInput) => {
  assertSessionUnlocked(context);
  const params = WalletApiKeyringsSchemas.unhideHdAccount.parse(input);
  await context.accounts.unhideHdAccount(params.accountKey);
  return null;
};

export const removePrivateKeyKeyring = async (context: WalletApiContext, input: RemovePrivateKeyKeyringInput) => {
  assertSessionUnlocked(context);
  const params = WalletApiKeyringsSchemas.removePrivateKeyKeyring.parse(input);
  await context.accounts.removePrivateKeyKeyring(params.keyringId);
  return null;
};

export const exportMnemonic = async (context: WalletApiContext, input: ExportMnemonicInput) => {
  const params = WalletApiKeyringsSchemas.exportMnemonic.parse(input);
  return { words: (await context.accounts.exportMnemonic(params.keyringId, params.password)).split(" ") };
};

export const exportPrivateKey = async (context: WalletApiContext, input: ExportPrivateKeyInput) => {
  const params = WalletApiKeyringsSchemas.exportPrivateKey.parse(input);
  const secret = await context.accounts.exportPrivateKeyByAccountKey(params.accountKey, params.password);
  return { privateKey: privateKeyBytesToHex(secret) };
};
