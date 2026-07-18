import type { AccountId } from "../accounts/accountId.js";
import { createAccountRecord } from "../accounts/accountRecord.js";
import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { deriveBip39Seed, importBip39KeySourceSecret } from "../keyring/bip39.js";
import { KeyringDuplicateSourceError, KeySourceNotFoundError } from "../keyring/errors.js";
import { getKeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import type { BackupStatus, KeySourceId } from "../keyring/persistence.js";
import {
  createKeyringSecrets,
  encodeKeyringSecrets,
  findKeySourceSecret,
  type PrivateKeySourceSecret,
} from "../keyring/secrets.js";
import { persistenceChange } from "../persistence/change.js";
import { replaceVaultPlaintext } from "../vault/crypto.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { WalletOperationRejectedError } from "./errors.js";
import { permissionChangesForRemovedAccounts, selectionChangesForRemovedAccounts } from "./removal.js";
import { requireKeyringSecrets } from "./unlocked.js";
import type { WalletContext } from "./Wallet.js";

const addMnemonic = async (
  wallet: WalletContext,
  params: { mnemonic: string; namespace: string; backupStatus: BackupStatus },
): Promise<AccountId> => {
  const keySourceId = crypto.randomUUID();
  const hdKeyringId = crypto.randomUUID();
  const createdAt = Date.now();
  const source = importBip39KeySourceSecret({
    keySourceId,
    mnemonic: params.mnemonic,
  });

  return await wallet.mutations.run(async (commit) => {
    const unlocked = wallet.vault.requireUnlocked();
    const secrets = requireKeyringSecrets(wallet);

    const existingSource = secrets.keySources.find(
      (candidate) => candidate.type === "bip39" && candidate.mnemonic === source.mnemonic,
    );
    if (existingSource) throw new KeyringDuplicateSourceError(existingSource.keySourceId);

    const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
    const seed = await deriveBip39Seed(source);
    const identity = adapter.deriveAccount({
      seed,
      derivationProfileId: adapter.defaultDerivationProfileId,
      derivationIndex: 0,
    });
    if (await wallet.readers.accounts.get(identity.accountId)) {
      throw new WalletOperationRejectedError("account_already_exists");
    }

    const account = createAccountRecord({
      accountId: identity.accountId,
      origin: { type: "hd", keyringId: hdKeyringId, derivationIndex: 0 },
      createAt: createdAt,
    });
    const keyringUpdate = wallet.keyring.prepareAddBip39Source({
      source: {
        keySourceId,
        type: "bip39",
        backupStatus: params.backupStatus,
        createdAt,
      },
      hdKeyring: {
        hdKeyringId,
        namespace: params.namespace,
        derivationProfileId: adapter.defaultDerivationProfileId,
        nextDerivationIndex: 1,
        createdAt,
      },
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
      ...keyringUpdate.persistenceChanges,
      persistenceChange.put(accountPersistenceType, account),
      ...selectionChanges,
    ];

    await commit(changes);

    wallet.vault.activate(nextUnlocked);
    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.keyring.activateSecrets(nextSecrets);
    wallet.autoLock.restart();
    wallet.publishChanged({ vault: true, accounts: [account.accountId] });
    wallet.publishKeyringChanged();

    return account.accountId;
  });
};

export const addNewMnemonic = async (
  wallet: WalletContext,
  params: { mnemonic: string; namespace: string },
): Promise<AccountId> => await addMnemonic(wallet, { ...params, backupStatus: "pending" });

export const importMnemonic = async (
  wallet: WalletContext,
  params: { mnemonic: string; namespace: string },
): Promise<AccountId> => await addMnemonic(wallet, { ...params, backupStatus: "confirmed" });

export const importPrivateKey = async (
  wallet: WalletContext,
  params: { privateKey: string; namespace: string },
): Promise<AccountId> => {
  const keySourceId = crypto.randomUUID();
  const createdAt = Date.now();
  const source: PrivateKeySourceSecret = {
    keySourceId,
    type: "private-key",
    privateKey: params.privateKey,
  };

  return await wallet.mutations.run(async (commit) => {
    const unlocked = wallet.vault.requireUnlocked();
    const secrets = requireKeyringSecrets(wallet);
    const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);

    const sourceRecords = new Map(wallet.keyring.listKeySources().map((record) => [record.keySourceId, record]));
    const existingSource = secrets.keySources.find((candidate) => {
      const record = sourceRecords.get(candidate.keySourceId);
      return (
        candidate.type === "private-key" &&
        candidate.privateKey === source.privateKey &&
        record?.type === "private-key" &&
        record.namespace === params.namespace
      );
    });
    if (existingSource) throw new KeyringDuplicateSourceError(existingSource.keySourceId);

    const identity = adapter.importPrivateKey(source);
    if (await wallet.readers.accounts.get(identity.accountId)) {
      throw new WalletOperationRejectedError("account_already_exists");
    }

    const account = createAccountRecord({
      accountId: identity.accountId,
      origin: { type: "private-key", keySourceId },
      createAt: createdAt,
    });
    const keyringUpdate = wallet.keyring.prepareAddPrivateKeySource({
      keySourceId,
      type: "private-key",
      namespace: params.namespace,
      createdAt,
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
      ...keyringUpdate.persistenceChanges,
      persistenceChange.put(accountPersistenceType, account),
      ...selectionChanges,
    ];

    await commit(changes);

    wallet.vault.activate(nextUnlocked);
    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.keyring.activateSecrets(nextSecrets);
    wallet.autoLock.restart();
    wallet.publishChanged({ vault: true, accounts: [account.accountId] });
    wallet.publishKeyringChanged();

    return account.accountId;
  });
};

export const confirmMnemonicBackup = async (
  wallet: WalletContext,
  params: { keySourceId: KeySourceId },
): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    const keyringUpdate = wallet.keyring.prepareConfirmBackup(params.keySourceId);
    if (!keyringUpdate) return;

    await commit(keyringUpdate.persistenceChanges);

    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.publishKeyringChanged();
  });
};

export const removeKeySource = async (wallet: WalletContext, keySourceId: KeySourceId): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    const unlocked = wallet.vault.requireUnlocked();
    const secrets = requireKeyringSecrets(wallet);

    const sourceRecord = wallet.keyring.getKeySource(keySourceId);
    if (!sourceRecord) throw new KeySourceNotFoundError(keySourceId);
    if (!findKeySourceSecret(secrets, keySourceId)) {
      throw new KeySourceNotFoundError(keySourceId);
    }

    const remainingSources = secrets.keySources.filter((source) => source.keySourceId !== keySourceId);
    if (remainingSources.length === 0) throw new WalletOperationRejectedError("last_source_requires_delete_wallet");

    const keyrings = sourceRecord.type === "bip39" ? wallet.keyring.listHdKeyringsByKeySourceIds([keySourceId]) : [];
    const accounts =
      sourceRecord.type === "bip39"
        ? await wallet.readers.accounts.listByKeyringIds(keyrings.map((keyring) => keyring.hdKeyringId))
        : await wallet.readers.accounts.listByPrivateKeySourceIds([keySourceId]);
    const accountIds = accounts.map((account) => account.accountId);
    const selectionChanges = await selectionChangesForRemovedAccounts(wallet, accountIds);
    const permissionChanges = await permissionChangesForRemovedAccounts(wallet, accountIds);
    const keyringUpdate = wallet.keyring.prepareRemoveKeySource(keySourceId);
    const nextSecrets = createKeyringSecrets(remainingSources);
    const nextUnlocked = await replaceVaultPlaintext(unlocked, encodeKeyringSecrets(nextSecrets));
    const changes = [
      persistenceChange.put(encryptedVaultPersistenceType, nextUnlocked.record),
      ...keyringUpdate.persistenceChanges,
      ...accountIds.map((accountId) => persistenceChange.remove(accountPersistenceType, accountId)),
      ...selectionChanges,
      ...permissionChanges,
    ];

    await commit(changes);

    wallet.vault.activate(nextUnlocked);
    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.keyring.activateSecrets(nextSecrets);
    wallet.autoLock.restart();
    wallet.publishChanged({ vault: true, accounts: accountIds });
    wallet.publishKeyringChanged();
  });
};
