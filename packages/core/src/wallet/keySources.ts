import type { AccountId } from "../accounts/accountId.js";
import { createAccountRecord } from "../accounts/accountRecord.js";
import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { getKeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import {
  type BackupStatus,
  hdKeyringPersistenceType,
  type KeySourceId,
  type KeySourceRecord,
  keySourcePersistenceType,
} from "../keyring/persistence.js";
import {
  type Bip39KeySourceSecret,
  canonicalizeMnemonicWords,
  createKeyringSecrets,
  encodeKeyringSecrets,
  findKeySourceSecret,
  type PrivateKeySourceSecret,
} from "../keyring/secrets.js";
import { persistenceChange } from "../persistence/change.js";
import { replaceVaultPlaintext } from "../vault/crypto.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { WalletOperationRejectedError, WalletRecordNotFoundError } from "./errors.js";
import { permissionChangesForRemovedAccounts, selectionChangesForRemovedAccounts } from "./removal.js";
import { requireKeyringSecrets } from "./unlocked.js";
import type { WalletContext } from "./Wallet.js";

const keySourceRecordsById = (records: readonly KeySourceRecord[]): Map<KeySourceId, KeySourceRecord> =>
  new Map(records.map((record) => [record.keySourceId, record]));

const addMnemonic = async (
  wallet: WalletContext,
  params: { mnemonic: string; passphrase?: string; namespace: string; backupStatus: BackupStatus },
): Promise<AccountId> => {
  const keySourceId = crypto.randomUUID();
  const keyringId = crypto.randomUUID();
  const createAt = Date.now();
  const source: Bip39KeySourceSecret = {
    keySourceId,
    type: "bip39",
    mnemonic: canonicalizeMnemonicWords(params.mnemonic),
    ...(params.passphrase ? { passphrase: params.passphrase } : {}),
  };

  return await wallet.mutations.run(async (commit) => {
    const unlocked = wallet.vault.requireUnlocked();
    const secrets = requireKeyringSecrets(wallet);

    const sourceAlreadyExists = secrets.keySources.some(
      (candidate) =>
        candidate.type === "bip39" &&
        candidate.mnemonic === source.mnemonic &&
        candidate.passphrase === source.passphrase,
    );
    if (sourceAlreadyExists) {
      throw new WalletOperationRejectedError("key_source_already_exists");
    }

    const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
    const identity = adapter.deriveAccount({
      source,
      derivationProfileId: adapter.defaultDerivationProfileId,
      derivationIndex: 0,
    });
    if (await wallet.readers.accounts.get(identity.accountId)) {
      throw new WalletOperationRejectedError("account_already_exists");
    }

    const account = createAccountRecord({
      accountId: identity.accountId,
      origin: { type: "hd", keyringId, derivationIndex: 0 },
      createAt,
    });
    const namespaceState = await wallet.readers.accounts.getNamespaceAccounts(params.namespace);
    const nextSecrets = createKeyringSecrets([...secrets.keySources, source]);
    const nextUnlocked = await replaceVaultPlaintext(unlocked, encodeKeyringSecrets(nextSecrets));
    const selectionChanges = namespaceState
      ? []
      : [
          persistenceChange.put(accountSelectionPersistenceType, {
            namespace: params.namespace,
            accountId: account.accountId,
          }),
        ];
    const changes = [
      persistenceChange.put(encryptedVaultPersistenceType, nextUnlocked.record),
      persistenceChange.put(keySourcePersistenceType, {
        keySourceId,
        type: "bip39",
        backupStatus: params.backupStatus,
        createAt,
      }),
      persistenceChange.put(hdKeyringPersistenceType, {
        keyringId,
        keySourceId,
        namespace: params.namespace,
        derivationProfileId: adapter.defaultDerivationProfileId,
        nextDerivationIndex: 1,
        createAt,
      }),
      persistenceChange.put(accountPersistenceType, account),
      ...selectionChanges,
    ];

    await commit(changes);

    wallet.vault.activate(nextUnlocked);
    wallet.keyring.activate(nextSecrets);
    wallet.autoLock.restart();
    wallet.publishChanged({ vault: true, accounts: [account.accountId], keySources: [keySourceId] });

    return account.accountId;
  });
};

export const addNewMnemonic = async (
  wallet: WalletContext,
  params: { mnemonic: string; passphrase?: string; namespace: string },
): Promise<AccountId> => await addMnemonic(wallet, { ...params, backupStatus: "pending" });

export const importMnemonic = async (
  wallet: WalletContext,
  params: { mnemonic: string; passphrase?: string; namespace: string },
): Promise<AccountId> => await addMnemonic(wallet, { ...params, backupStatus: "confirmed" });

export const importPrivateKey = async (
  wallet: WalletContext,
  params: { privateKey: string; namespace: string },
): Promise<AccountId> => {
  const keySourceId = crypto.randomUUID();
  const createAt = Date.now();
  const source: PrivateKeySourceSecret = {
    keySourceId,
    type: "private-key",
    privateKey: params.privateKey,
  };

  return await wallet.mutations.run(async (commit) => {
    const unlocked = wallet.vault.requireUnlocked();
    const secrets = requireKeyringSecrets(wallet);
    const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);

    const sourceRecords = keySourceRecordsById(await wallet.readers.keySources.listAll());
    const sourceAlreadyExists = secrets.keySources.some((candidate) => {
      const record = sourceRecords.get(candidate.keySourceId);
      return (
        candidate.type === "private-key" &&
        candidate.privateKey === source.privateKey &&
        record?.type === "private-key" &&
        record.namespace === params.namespace
      );
    });
    if (sourceAlreadyExists) {
      throw new WalletOperationRejectedError("key_source_already_exists");
    }

    const identity = adapter.importPrivateKey(source);
    if (await wallet.readers.accounts.get(identity.accountId)) {
      throw new WalletOperationRejectedError("account_already_exists");
    }

    const account = createAccountRecord({
      accountId: identity.accountId,
      origin: { type: "private-key", keySourceId },
      createAt,
    });
    const namespaceState = await wallet.readers.accounts.getNamespaceAccounts(params.namespace);
    const nextSecrets = createKeyringSecrets([...secrets.keySources, source]);
    const nextUnlocked = await replaceVaultPlaintext(unlocked, encodeKeyringSecrets(nextSecrets));
    const selectionChanges = namespaceState
      ? []
      : [
          persistenceChange.put(accountSelectionPersistenceType, {
            namespace: params.namespace,
            accountId: account.accountId,
          }),
        ];
    const changes = [
      persistenceChange.put(encryptedVaultPersistenceType, nextUnlocked.record),
      persistenceChange.put(keySourcePersistenceType, {
        keySourceId,
        type: "private-key",
        namespace: params.namespace,
        createAt,
      }),
      persistenceChange.put(accountPersistenceType, account),
      ...selectionChanges,
    ];

    await commit(changes);

    wallet.vault.activate(nextUnlocked);
    wallet.keyring.activate(nextSecrets);
    wallet.autoLock.restart();
    wallet.publishChanged({ vault: true, accounts: [account.accountId], keySources: [keySourceId] });

    return account.accountId;
  });
};

export const confirmMnemonicBackup = async (
  wallet: WalletContext,
  params: { keySourceId: KeySourceId; mnemonic: string },
): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    const source = await wallet.readers.keySources.get(params.keySourceId);
    if (!source) throw new WalletRecordNotFoundError("keySource", params.keySourceId);
    if (source.type !== "bip39") throw new WalletOperationRejectedError("backup_only_applies_to_bip39");
    if (source.backupStatus === "confirmed") return;

    wallet.vault.requireUnlocked();
    const secret = findKeySourceSecret(requireKeyringSecrets(wallet), params.keySourceId);
    if (secret?.type !== "bip39") throw new WalletRecordNotFoundError("keySource", params.keySourceId);
    if (canonicalizeMnemonicWords(params.mnemonic) !== secret.mnemonic) {
      throw new WalletOperationRejectedError("mnemonic_does_not_match_key_source");
    }

    await commit([persistenceChange.put(keySourcePersistenceType, { ...source, backupStatus: "confirmed" })]);

    wallet.autoLock.restart();
    wallet.publishChanged({ keySources: [params.keySourceId] });
  });
};

export const removeKeySource = async (wallet: WalletContext, keySourceId: KeySourceId): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    const unlocked = wallet.vault.requireUnlocked();
    const secrets = requireKeyringSecrets(wallet);

    const sourceRecord = await wallet.readers.keySources.get(keySourceId);
    if (!sourceRecord) throw new WalletRecordNotFoundError("keySource", keySourceId);
    if (!findKeySourceSecret(secrets, keySourceId)) {
      throw new WalletRecordNotFoundError("keySource", keySourceId);
    }

    const remainingSources = secrets.keySources.filter((source) => source.keySourceId !== keySourceId);
    if (remainingSources.length === 0) throw new WalletOperationRejectedError("last_source_requires_delete_wallet");

    const keyrings =
      sourceRecord.type === "bip39" ? await wallet.readers.hdKeyrings.listByKeySourceIds([keySourceId]) : [];
    const accounts =
      sourceRecord.type === "bip39"
        ? await wallet.readers.accounts.listByKeyringIds(keyrings.map((keyring) => keyring.keyringId))
        : await wallet.readers.accounts.listByPrivateKeySourceIds([keySourceId]);
    const accountIds = accounts.map((account) => account.accountId);
    const selectionChanges = await selectionChangesForRemovedAccounts(wallet, accountIds);
    const permissionChanges = await permissionChangesForRemovedAccounts(wallet, accountIds);
    const nextSecrets = createKeyringSecrets(remainingSources);
    const nextUnlocked = await replaceVaultPlaintext(unlocked, encodeKeyringSecrets(nextSecrets));
    const changes = [
      persistenceChange.put(encryptedVaultPersistenceType, nextUnlocked.record),
      persistenceChange.remove(keySourcePersistenceType, keySourceId),
      ...keyrings.map((keyring) => persistenceChange.remove(hdKeyringPersistenceType, keyring.keyringId)),
      ...accountIds.map((accountId) => persistenceChange.remove(accountPersistenceType, accountId)),
      ...selectionChanges,
      ...permissionChanges,
    ];

    await commit(changes);

    wallet.vault.activate(nextUnlocked);
    wallet.keyring.activate(nextSecrets);
    wallet.autoLock.restart();
    wallet.publishChanged({ vault: true, accounts: accountIds, keySources: [keySourceId] });
  });
};
