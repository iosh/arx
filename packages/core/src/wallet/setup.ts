import type { AccountId } from "../accounts/accountId.js";
import { createAccountRecord } from "../accounts/accountRecord.js";
import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { deriveBip39Seed, importBip39KeySourceSecret } from "../keyring/bip39.js";
import { getKeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import type { BackupStatus } from "../keyring/persistence.js";
import { createKeyringSecrets, encodeKeyringSecrets, type PrivateKeySourceSecret } from "../keyring/secrets.js";
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
    namespace: string;
    backupStatus: BackupStatus;
  },
): Promise<AccountId> => {
  const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
  const keySourceId = crypto.randomUUID();
  const hdKeyringId = crypto.randomUUID();
  const createdAt = Date.now();
  const source = importBip39KeySourceSecret({
    keySourceId,
    mnemonic: params.mnemonic,
  });

  return await wallet.mutations.run(async (commit) => {
    if (await wallet.readers.encryptedVault.get()) throw new WalletAlreadyInitializedError();

    const seed = await deriveBip39Seed(source);
    const identity = adapter.deriveAccount({
      seed,
      derivationProfileId: adapter.defaultDerivationProfileId,
      derivationIndex: 0,
    });
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

    const secrets = createKeyringSecrets([source]);
    const unlocked = await createUnlockedVault({
      password: params.password,
      plaintext: encodeKeyringSecrets(secrets),
    });
    const changes = [
      persistenceChange.put(encryptedVaultPersistenceType, unlocked.record),
      ...keyringUpdate.persistenceChanges,
      persistenceChange.put(accountPersistenceType, account),
      persistenceChange.put(accountSelectionPersistenceType, {
        namespace: params.namespace,
        accountId: account.accountId,
      }),
    ];

    await commit(changes);

    wallet.vault.activate(unlocked);
    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.keyring.activateSecrets(secrets);
    wallet.autoLock.start();
    wallet.publishChanged({ vault: true, accounts: [account.accountId] });
    wallet.publishKeyringChanged();

    return account.accountId;
  });
};

export const initializeWithNewMnemonic = async (
  wallet: WalletContext,
  params: { password: string; mnemonic: string; namespace: string },
): Promise<AccountId> => await initializeBip39(wallet, { ...params, backupStatus: "pending" });

export const initializeFromMnemonic = async (
  wallet: WalletContext,
  params: { password: string; mnemonic: string; namespace: string },
): Promise<AccountId> => await initializeBip39(wallet, { ...params, backupStatus: "confirmed" });

export const initializeFromPrivateKey = async (
  wallet: WalletContext,
  params: { password: string; privateKey: string; namespace: string },
): Promise<AccountId> => {
  const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
  const keySourceId = crypto.randomUUID();
  const createdAt = Date.now();
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
      createAt: createdAt,
    });
    const keyringUpdate = wallet.keyring.prepareAddPrivateKeySource({
      keySourceId,
      type: "private-key",
      namespace: params.namespace,
      createdAt,
    });

    const secrets = createKeyringSecrets([source]);
    const unlocked = await createUnlockedVault({
      password: params.password,
      plaintext: encodeKeyringSecrets(secrets),
    });
    const changes = [
      persistenceChange.put(encryptedVaultPersistenceType, unlocked.record),
      ...keyringUpdate.persistenceChanges,
      persistenceChange.put(accountPersistenceType, account),
      persistenceChange.put(accountSelectionPersistenceType, {
        namespace: params.namespace,
        accountId: account.accountId,
      }),
    ];

    await commit(changes);

    wallet.vault.activate(unlocked);
    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.keyring.activateSecrets(secrets);
    wallet.autoLock.start();
    wallet.publishChanged({ vault: true, accounts: [account.accountId] });
    wallet.publishKeyringChanged();

    return account.accountId;
  });
};
