import type { AccountId } from "../accounts/accountId.js";
import { createAccountRecord } from "../accounts/accountRecord.js";
import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { getKeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import { type BackupStatus, hdKeyringPersistenceType, keySourcePersistenceType } from "../keyring/persistence.js";
import {
  type Bip39KeySourceSecret,
  canonicalizeMnemonicWords,
  createKeyringSecrets,
  encodeKeyringSecrets,
  type PrivateKeySourceSecret,
} from "../keyring/secrets.js";
import { persistenceChange } from "../persistence/change.js";
import { createUnlockedVault } from "../vault/crypto.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { WalletAlreadyInitializedError } from "./errors.js";
import type { WalletContext } from "./Wallet.js";

const initializeBip39 = async (
  wallet: WalletContext,
  params: {
    password: string;
    mnemonic: string;
    passphrase?: string;
    namespace: string;
    backupStatus: BackupStatus;
  },
): Promise<AccountId> => {
  const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
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
    if (await wallet.readers.encryptedVault.get()) throw new WalletAlreadyInitializedError();

    const identity = adapter.deriveAccount({
      source,
      derivationProfileId: adapter.defaultDerivationProfileId,
      derivationIndex: 0,
    });
    const account = createAccountRecord({
      accountId: identity.accountId,
      origin: { type: "hd", keyringId, derivationIndex: 0 },
      createAt,
    });

    const secrets = createKeyringSecrets([source]);
    const unlocked = await createUnlockedVault({
      password: params.password,
      plaintext: encodeKeyringSecrets(secrets),
    });
    const changes = [
      persistenceChange.put(encryptedVaultPersistenceType, unlocked.record),
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
      persistenceChange.put(accountSelectionPersistenceType, {
        namespace: params.namespace,
        accountId: account.accountId,
      }),
    ];

    await commit(changes);

    wallet.vault.activate(unlocked);
    wallet.keyring.activate(secrets);
    wallet.autoLock.start();
    wallet.publishChanged({ vault: true, accounts: [account.accountId], keySources: [keySourceId] });

    return account.accountId;
  });
};

export const initializeWithNewMnemonic = async (
  wallet: WalletContext,
  params: { password: string; mnemonic: string; passphrase?: string; namespace: string },
): Promise<AccountId> => await initializeBip39(wallet, { ...params, backupStatus: "pending" });

export const initializeFromMnemonic = async (
  wallet: WalletContext,
  params: { password: string; mnemonic: string; passphrase?: string; namespace: string },
): Promise<AccountId> => await initializeBip39(wallet, { ...params, backupStatus: "confirmed" });

export const initializeFromPrivateKey = async (
  wallet: WalletContext,
  params: { password: string; privateKey: string; namespace: string },
): Promise<AccountId> => {
  const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
  const keySourceId = crypto.randomUUID();
  const createAt = Date.now();
  const source: PrivateKeySourceSecret = {
    keySourceId,
    type: "private-key",
    privateKey: params.privateKey,
  };

  return await wallet.mutations.run(async (commit) => {
    if (await wallet.readers.encryptedVault.get()) throw new WalletAlreadyInitializedError();

    const identity = adapter.importPrivateKey(source);
    const account = createAccountRecord({
      accountId: identity.accountId,
      origin: { type: "private-key", keySourceId },
      createAt,
    });

    const secrets = createKeyringSecrets([source]);
    const unlocked = await createUnlockedVault({
      password: params.password,
      plaintext: encodeKeyringSecrets(secrets),
    });
    const changes = [
      persistenceChange.put(encryptedVaultPersistenceType, unlocked.record),
      persistenceChange.put(keySourcePersistenceType, {
        keySourceId,
        type: "private-key",
        namespace: params.namespace,
        createAt,
      }),
      persistenceChange.put(accountPersistenceType, account),
      persistenceChange.put(accountSelectionPersistenceType, {
        namespace: params.namespace,
        accountId: account.accountId,
      }),
    ];

    await commit(changes);

    wallet.vault.activate(unlocked);
    wallet.keyring.activate(secrets);
    wallet.autoLock.start();
    wallet.publishChanged({ vault: true, accounts: [account.accountId], keySources: [keySourceId] });

    return account.accountId;
  });
};
