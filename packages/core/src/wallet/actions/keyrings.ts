import { canonicalChainAddressFromAccountId, getAccountIdNamespace } from "../../accounts/addressing/accountId.js";
import type { AccountAddressingByNamespace } from "../../accounts/addressing/addressing.js";
import type { WalletAccounts, WalletNetworks, WalletSession } from "../../engine/types.js";
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
import type { AccountMeta, KeyringMeta } from "../types.js";
import { getSelectedWalletChainRefForNamespace } from "./chains.js";
import { selectCreatedAccount } from "./createdAccountSelection.js";
import { assertSessionUnlocked } from "./session.js";

type KeyringHandlersDeps = {
  session: Pick<WalletSession, "isUnlocked">;
  accounts: WalletAccounts;
  networks: Pick<WalletNetworks, "getSelectedNamespace" | "getSelectedChainRef" | "getActiveChainViewForNamespace">;
  accountAddressing: AccountAddressingByNamespace;
};

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

const buildAccountMetaFromRecord = (deps: KeyringHandlersDeps, record: AccountRecord): AccountMeta => {
  const namespace = getAccountIdNamespace(record.accountId);
  return {
    accountId: record.accountId,
    canonicalAddress: canonicalChainAddressFromAccountId({
      accountAddressing: deps.accountAddressing,
      chainRef: getSelectedWalletChainRefForNamespace(deps.networks, namespace),
      accountId: record.accountId,
    }),
    keyringId: record.keyringId,
    createdAt: record.createdAt,
    ...(record.derivationIndex !== undefined ? { derivationIndex: record.derivationIndex } : {}),
    ...(record.alias !== undefined ? { alias: record.alias } : {}),
    ...(record.hidden !== undefined ? { hidden: record.hidden } : {}),
  };
};

export const createKeyringsHandlers = (deps: KeyringHandlersDeps) => ({
  list: () => deps.accounts.getKeyrings().map(buildKeyringMetaFromRecord),

  getAccountsByKeyring: (input: WalletApiAccountsByKeyringInput) =>
    deps.accounts
      .getAccountsByKeyring(input.keyringId, input.includeHidden ?? false)
      .map((record) => buildAccountMetaFromRecord(deps, record)),

  getBackupStatus: () => deps.accounts.getBackupStatus(),

  confirmNewMnemonic: async (input: ConfirmNewMnemonicInput) => {
    assertSessionUnlocked(deps.session);
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

    const result = await deps.accounts.confirmNewMnemonic(command);
    const selection: { address: string; namespace?: string } = { address: result.address };
    if (command.namespace !== undefined) {
      selection.namespace = command.namespace;
    }
    await selectCreatedAccount(deps, selection);
    return result;
  },

  importMnemonic: async (input: ImportMnemonicInput) => {
    assertSessionUnlocked(deps.session);
    const command: ImportMnemonicParams = {
      mnemonic: input.words.join(" "),
    };
    if (input.alias !== undefined) {
      command.alias = input.alias;
    }
    if (input.namespace !== undefined) {
      command.namespace = input.namespace;
    }

    const result = await deps.accounts.importMnemonic(command);
    const selection: { address: string; namespace?: string } = { address: result.address };
    if (command.namespace !== undefined) {
      selection.namespace = command.namespace;
    }
    await selectCreatedAccount(deps, selection);
    return result;
  },

  importPrivateKey: async (input: ImportPrivateKeyInput) => {
    assertSessionUnlocked(deps.session);
    const command: ImportPrivateKeyParams = {
      privateKey: input.privateKey,
    };
    if (input.alias !== undefined) {
      command.alias = input.alias;
    }
    if (input.namespace !== undefined) {
      command.namespace = input.namespace;
    }

    const result = await deps.accounts.importPrivateKey(command);
    const selection: { address: string; namespace?: string } = { address: result.account.address };
    if (command.namespace !== undefined) {
      selection.namespace = command.namespace;
    }
    await selectCreatedAccount(deps, selection);
    return result;
  },

  deriveAccount: async (input: DeriveAccountInput) => {
    assertSessionUnlocked(deps.session);
    return await deps.accounts.deriveAccount(input.keyringId);
  },

  renameKeyring: async (input: RenameKeyringInput) => {
    assertSessionUnlocked(deps.session);
    await deps.accounts.renameKeyring(input.keyringId, input.alias);
    return null;
  },

  renameAccount: async (input: RenameAccountInput) => {
    assertSessionUnlocked(deps.session);
    await deps.accounts.renameAccount(input.accountId, input.alias);
    return null;
  },

  markBackedUp: async (input: MarkBackedUpInput) => {
    assertSessionUnlocked(deps.session);
    await deps.accounts.markBackedUp(input.keyringId);
    return null;
  },

  hideHdAccount: async (input: HideHdAccountInput) => {
    assertSessionUnlocked(deps.session);
    const namespace = getAccountIdNamespace(input.accountId);
    const chainRef = getSelectedWalletChainRefForNamespace(deps.networks, namespace);
    const activeAccount = deps.accounts.getActiveAccountForNamespace({ namespace, chainRef });
    if (activeAccount?.accountId === input.accountId) {
      throw new PermissionDeniedError();
    }
    await deps.accounts.hideHdAccount(input.accountId);
    return null;
  },

  unhideHdAccount: async (input: UnhideHdAccountInput) => {
    assertSessionUnlocked(deps.session);
    await deps.accounts.unhideHdAccount(input.accountId);
    return null;
  },

  removePrivateKeyKeyring: async (input: RemovePrivateKeyKeyringInput) => {
    assertSessionUnlocked(deps.session);
    await deps.accounts.removePrivateKeyKeyring(input.keyringId);
    return null;
  },

  exportMnemonic: async (input: ExportMnemonicInput) => ({
    words: (await deps.accounts.exportMnemonic(input.keyringId, input.password)).split(" "),
  }),

  exportPrivateKey: async (input: ExportPrivateKeyInput) => {
    const secret = await deps.accounts.exportPrivateKeyByAccountId(input.accountId, input.password);
    return { privateKey: privateKeyBytesToHex(secret) };
  },
});
