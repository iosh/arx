import { accountsChangedFromUpdate } from "../accounts/Accounts.js";
import type { AccountRecord } from "../accounts/persistence.js";
import { deriveBip39Seed, importBip39KeySourceSecret } from "../keyring/bip39.js";
import { getKeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import type { BackupStatus } from "../keyring/persistence.js";
import { createKeyringSecrets, encodeKeyringSecrets, type PrivateKeySourceSecret } from "../keyring/secrets.js";
import { persistenceChange } from "../persistence/change.js";
import { createUnlockedVault } from "../vault/crypto.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { WalletAlreadyInitializedError } from "./errors.js";
import type {
  Bip39WalletCreated,
  CreateFromMnemonicInput,
  CreateFromPrivateKeyInput,
  PrivateKeyWalletCreated,
  RestoreFromMnemonicInput,
  WalletContext,
} from "./Wallet.js";

const initializeBip39 = async (
  wallet: WalletContext,
  params: {
    password: string;
    mnemonic: string;
    namespace: string;
    backupStatus: BackupStatus;
  },
): Promise<Bip39WalletCreated> => {
  const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
  const keySourceId = crypto.randomUUID();
  const hdKeyringId = crypto.randomUUID();
  const createdAt = wallet.time.now();
  const source = importBip39KeySourceSecret({
    keySourceId,
    mnemonic: params.mnemonic,
  });

  return await wallet.mutations.run(async (commit) => {
    if (wallet.vault.getStatus() !== "uninitialized") throw new WalletAlreadyInitializedError();

    const seed = await deriveBip39Seed(source);
    const accountId = adapter.deriveHdAccountId({
      seed,
      derivationIndex: 0,
    });
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

    const secrets = createKeyringSecrets([source]);
    const unlocked = await createUnlockedVault({
      password: params.password,
      plaintext: encodeKeyringSecrets(secrets),
    });
    const changes = [
      persistenceChange.put(encryptedVaultPersistenceType, unlocked.record),
      ...keyringUpdate.persistenceChanges,
      ...accountsUpdate.persistenceChanges,
    ];

    await commit(changes);

    wallet.vault.activate(unlocked);
    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.accounts.applyCommittedUpdate(accountsUpdate);
    wallet.keyring.activateSecrets(secrets);
    wallet.autoLock.start();
    wallet.publishStatusChanged({ type: "walletStatusChanged", status: "unlocked" });
    wallet.publishKeyringChanged();
    wallet.publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));

    return { keySourceId, hdKeyringId, accountId: account.accountId };
  });
};

export const createFromMnemonic = async (
  wallet: WalletContext,
  params: CreateFromMnemonicInput,
): Promise<Bip39WalletCreated> => await initializeBip39(wallet, { ...params, backupStatus: "pending" });

export const restoreFromMnemonic = async (
  wallet: WalletContext,
  params: RestoreFromMnemonicInput,
): Promise<Bip39WalletCreated> => await initializeBip39(wallet, { ...params, backupStatus: "confirmed" });

export const createFromPrivateKey = async (
  wallet: WalletContext,
  params: CreateFromPrivateKeyInput,
): Promise<PrivateKeyWalletCreated> => {
  const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
  const keySourceId = crypto.randomUUID();
  const createdAt = wallet.time.now();
  const source: PrivateKeySourceSecret = {
    keySourceId,
    type: "private-key",
    privateKey: params.privateKey,
  };

  return await wallet.mutations.run(async (commit) => {
    if (wallet.vault.getStatus() !== "uninitialized") throw new WalletAlreadyInitializedError();

    const accountId = adapter.accountIdFromPrivateKey(source.privateKey);
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

    const secrets = createKeyringSecrets([source]);
    const unlocked = await createUnlockedVault({
      password: params.password,
      plaintext: encodeKeyringSecrets(secrets),
    });
    const changes = [
      persistenceChange.put(encryptedVaultPersistenceType, unlocked.record),
      ...keyringUpdate.persistenceChanges,
      ...accountsUpdate.persistenceChanges,
    ];

    await commit(changes);

    wallet.vault.activate(unlocked);
    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.accounts.applyCommittedUpdate(accountsUpdate);
    wallet.keyring.activateSecrets(secrets);
    wallet.autoLock.start();
    wallet.publishStatusChanged({ type: "walletStatusChanged", status: "unlocked" });
    wallet.publishKeyringChanged();
    wallet.publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));

    return { keySourceId, accountId: account.accountId };
  });
};
