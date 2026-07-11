import { createAccountRecord } from "../accounts/accountRecord.js";
import type { AccountId } from "../accounts/addressing/accountId.js";
import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { getKeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import { type BackupStatus, hdKeyringPersistenceType, keySourcePersistenceType } from "../keyring/persistence.js";
import type { UnlockedSigner } from "../keyring/UnlockedSigners.js";
import { persistenceChange } from "../persistence/change.js";
import { createUnlockedVault } from "../vault/crypto.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { type Bip39KeySource, joinMnemonicWords, type PrivateKeySource } from "../vault/secrets.js";
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
  const source: Bip39KeySource = {
    keySourceId,
    type: "bip39",
    mnemonic: joinMnemonicWords(params.mnemonic),
    ...(params.passphrase ? { passphrase: params.passphrase } : {}),
  };
  const signer = adapter.deriveAccount({
    source,
    derivationProfileId: adapter.defaultDerivationProfileId,
    derivationIndex: 0,
  });
  const account = createAccountRecord({
    accountId: signer.accountId,
    origin: { type: "hd", keyringId, derivationIndex: 0 },
    createAt: Date.now(),
  });
  const unlocked = await createUnlockedVault({ password: params.password, secrets: { keySources: [source] } });
  let signerOwnedByDraft = true;

  try {
    await wallet.mutations.run(async (commit) => {
      if (await wallet.readers.encryptedVault.get()) throw new WalletAlreadyInitializedError();
      await commit([
        persistenceChange.put(encryptedVaultPersistenceType, unlocked.record),
        persistenceChange.put(keySourcePersistenceType, {
          keySourceId,
          type: "bip39",
          backupStatus: params.backupStatus,
        }),
        persistenceChange.put(hdKeyringPersistenceType, {
          keyringId,
          keySourceId,
          namespace: params.namespace,
          derivationProfileId: adapter.defaultDerivationProfileId,
          nextDerivationIndex: 1,
        }),
        persistenceChange.put(accountPersistenceType, account),
        persistenceChange.put(accountSelectionPersistenceType, {
          namespace: params.namespace,
          accountId: account.accountId,
        }),
      ]);
      wallet.vault.activate(unlocked);
      wallet.signers.replace({ signers: [signer] });
      signerOwnedByDraft = false;
      wallet.autoLock.start();
      wallet.publishChanged({ vault: true, accounts: [account.accountId], keySources: [keySourceId] });
    });
    return account.accountId;
  } catch (error) {
    if (signerOwnedByDraft) signer.clear();
    throw error;
  }
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
  const source: PrivateKeySource = {
    keySourceId,
    type: "private-key",
    algorithm: adapter.privateKeyAlgorithm,
    privateKey: params.privateKey,
  };
  const signer: UnlockedSigner = adapter.importPrivateKey(source);
  const account = createAccountRecord({
    accountId: signer.accountId,
    origin: { type: "private-key", keySourceId },
    createAt: Date.now(),
  });
  const unlocked = await createUnlockedVault({ password: params.password, secrets: { keySources: [source] } });
  let signerOwnedByDraft = true;

  try {
    await wallet.mutations.run(async (commit) => {
      if (await wallet.readers.encryptedVault.get()) throw new WalletAlreadyInitializedError();
      await commit([
        persistenceChange.put(encryptedVaultPersistenceType, unlocked.record),
        persistenceChange.put(keySourcePersistenceType, { keySourceId, type: "private-key" }),
        persistenceChange.put(accountPersistenceType, account),
        persistenceChange.put(accountSelectionPersistenceType, {
          namespace: params.namespace,
          accountId: account.accountId,
        }),
      ]);
      wallet.vault.activate(unlocked);
      wallet.signers.replace({ signers: [signer] });
      signerOwnedByDraft = false;
      wallet.autoLock.start();
      wallet.publishChanged({ vault: true, accounts: [account.accountId], keySources: [keySourceId] });
    });
    return account.accountId;
  } catch (error) {
    if (signerOwnedByDraft) signer.clear();
    throw error;
  }
};
