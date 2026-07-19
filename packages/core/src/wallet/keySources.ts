import { accountsChangedFromUpdate } from "../accounts/Accounts.js";
import type { AccountRecord } from "../accounts/persistence.js";
import { deriveBip39Seed, generateBip39Mnemonic, importBip39KeySourceSecret } from "../keyring/bip39.js";
import { KeyringDuplicateSourceError, KeySourceNotFoundError, KeySourceTypeMismatchError } from "../keyring/errors.js";
import { getKeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import type { BackupStatus, KeySourceId } from "../keyring/persistence.js";
import {
  createKeyringSecrets,
  encodeKeyringSecrets,
  findKeySourceSecret,
  type PrivateKeySourceSecret,
} from "../keyring/secrets.js";
import { persistenceChange } from "../persistence/change.js";
import { replaceVaultPlaintext, unlockVaultRecord } from "../vault/crypto.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { requireKeyringSecrets } from "./unlocked.js";
import type {
  Bip39SourceAdded,
  MnemonicSourceInput,
  PrivateKeySourceAdded,
  PrivateKeySourceInput,
  WalletContext,
} from "./Wallet.js";

const verifyCurrentPassword = async (wallet: WalletContext, password: string): Promise<void> => {
  // Re-decrypting the authenticated record verifies the password without changing the active session.
  await unlockVaultRecord(wallet.vault.requireRecord(), password);
};

const addBip39Source = async (
  wallet: WalletContext,
  params: MnemonicSourceInput & { backupStatus: BackupStatus },
): Promise<Bip39SourceAdded> => {
  const keySourceId = crypto.randomUUID();
  const hdKeyringId = crypto.randomUUID();
  const source = importBip39KeySourceSecret({
    keySourceId,
    mnemonic: params.mnemonic,
  });

  return await wallet.mutations.run(async (commit) => {
    const secrets = requireKeyringSecrets(wallet);
    const unlocked = wallet.vault.requireUnlocked();

    const existingSource = secrets.keySources.find(
      (candidate) => candidate.type === "bip39" && candidate.mnemonic === source.mnemonic,
    );
    if (existingSource) throw new KeyringDuplicateSourceError(existingSource.keySourceId);

    const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
    const seed = await deriveBip39Seed(source);
    const accountId = adapter.deriveHdAccountId({
      seed,
      derivationIndex: 0,
    });
    const createdAt = wallet.time.now();
    const account: Omit<AccountRecord, "hidden"> = {
      accountId,
      origin: { type: "hd", hdKeyringId, derivationIndex: 0 },
      createdAt,
    };
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
        nextDerivationIndex: 1,
        createdAt,
      },
    });
    const accountsUpdate = wallet.accounts.prepareAddAccount(account);
    const nextSecrets = createKeyringSecrets([...secrets.keySources, source]);
    const nextUnlocked = await replaceVaultPlaintext(unlocked, encodeKeyringSecrets(nextSecrets));
    const changes = [
      persistenceChange.put(encryptedVaultPersistenceType, nextUnlocked.record),
      ...keyringUpdate.persistenceChanges,
      ...accountsUpdate.persistenceChanges,
    ];

    await commit(changes);

    wallet.vault.activate(nextUnlocked);
    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.accounts.applyCommittedUpdate(accountsUpdate);
    wallet.keyring.activateSecrets(nextSecrets);
    wallet.autoLock.recordActivity();
    wallet.publishKeyringChanged();
    wallet.publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));

    return { keySourceId, hdKeyringId, accountId };
  });
};

export const generateMnemonic = (): { mnemonic: string } => ({
  mnemonic: generateBip39Mnemonic(),
});

export const addMnemonic = async (wallet: WalletContext, params: MnemonicSourceInput): Promise<Bip39SourceAdded> =>
  await addBip39Source(wallet, { ...params, backupStatus: "pending" });

export const importMnemonic = async (wallet: WalletContext, params: MnemonicSourceInput): Promise<Bip39SourceAdded> =>
  await addBip39Source(wallet, { ...params, backupStatus: "confirmed" });

export const importPrivateKey = async (
  wallet: WalletContext,
  params: PrivateKeySourceInput,
): Promise<PrivateKeySourceAdded> => {
  const keySourceId = crypto.randomUUID();
  const source: PrivateKeySourceSecret = {
    keySourceId,
    type: "private-key",
    privateKey: params.privateKey,
  };

  return await wallet.mutations.run(async (commit) => {
    const secrets = requireKeyringSecrets(wallet);
    const unlocked = wallet.vault.requireUnlocked();
    const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
    const accountId = adapter.accountIdFromPrivateKey(source.privateKey);
    const existingAccount = wallet.accounts.getAccountRecord(accountId);
    if (existingAccount?.origin.type === "private-key") {
      throw new KeyringDuplicateSourceError(existingAccount.origin.keySourceId);
    }

    const createdAt = wallet.time.now();
    const account: Omit<AccountRecord, "hidden"> = {
      accountId,
      origin: { type: "private-key", keySourceId },
      createdAt,
    };
    const keyringUpdate = wallet.keyring.prepareAddPrivateKeySource({
      keySourceId,
      type: "private-key",
      namespace: params.namespace,
      createdAt,
    });
    const accountsUpdate = wallet.accounts.prepareAddAccount(account);
    const nextSecrets = createKeyringSecrets([...secrets.keySources, source]);
    const nextUnlocked = await replaceVaultPlaintext(unlocked, encodeKeyringSecrets(nextSecrets));
    const changes = [
      persistenceChange.put(encryptedVaultPersistenceType, nextUnlocked.record),
      ...keyringUpdate.persistenceChanges,
      ...accountsUpdate.persistenceChanges,
    ];

    await commit(changes);

    wallet.vault.activate(nextUnlocked);
    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.accounts.applyCommittedUpdate(accountsUpdate);
    wallet.keyring.activateSecrets(nextSecrets);
    wallet.autoLock.recordActivity();
    wallet.publishKeyringChanged();
    wallet.publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));

    return { keySourceId, accountId };
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

export const exportMnemonic = async (
  wallet: WalletContext,
  params: { keySourceId: KeySourceId; password: string },
): Promise<{ mnemonic: string }> => {
  return await wallet.mutations.run(async () => {
    const secrets = requireKeyringSecrets(wallet);
    const source = findKeySourceSecret(secrets, params.keySourceId);
    if (!source) throw new KeySourceNotFoundError(params.keySourceId);
    if (source.type !== "bip39") {
      throw new KeySourceTypeMismatchError({
        keySourceId: params.keySourceId,
        expectedType: "bip39",
        actualType: source.type,
      });
    }

    await verifyCurrentPassword(wallet, params.password);

    wallet.autoLock.recordActivity();
    return { mnemonic: source.mnemonic };
  });
};

export const exportPrivateKey = async (
  wallet: WalletContext,
  params: { keySourceId: KeySourceId; password: string },
): Promise<{ privateKey: string }> => {
  return await wallet.mutations.run(async () => {
    const secrets = requireKeyringSecrets(wallet);
    const source = findKeySourceSecret(secrets, params.keySourceId);
    if (!source) throw new KeySourceNotFoundError(params.keySourceId);
    if (source.type !== "private-key") {
      throw new KeySourceTypeMismatchError({
        keySourceId: params.keySourceId,
        expectedType: "private-key",
        actualType: source.type,
      });
    }

    await verifyCurrentPassword(wallet, params.password);

    wallet.autoLock.recordActivity();
    return { privateKey: source.privateKey };
  });
};
