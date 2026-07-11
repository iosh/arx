import { createAccountRecord } from "../accounts/accountRecord.js";
import type { AccountId } from "../accounts/addressing/accountId.js";
import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { getKeyringNamespaceAdapter, type KeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import {
  type BackupStatus,
  hdKeyringPersistenceType,
  type KeySourceId,
  keySourcePersistenceType,
} from "../keyring/persistence.js";
import type { UnlockedSigner } from "../keyring/UnlockedSigners.js";
import { persistenceChange } from "../persistence/change.js";
import { replaceVaultSecrets } from "../vault/crypto.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { type Bip39KeySource, joinMnemonicWords, type PrivateKeySource } from "../vault/secrets.js";
import { WalletOperationRejectedError, WalletRecordNotFoundError } from "./errors.js";
import { permissionChangesForRemovedAccounts, selectionChangesForRemovedAccounts } from "./removal.js";
import type { WalletContext } from "./Wallet.js";

const clearSigner = (signer: UnlockedSigner | null): void => signer?.clear();

const addMnemonic = async (
  wallet: WalletContext,
  params: { mnemonic: string; passphrase?: string; namespace: string; backupStatus: BackupStatus },
): Promise<AccountId> => {
  const keySourceId = crypto.randomUUID();
  const keyringId = crypto.randomUUID();
  const source: Bip39KeySource = {
    keySourceId,
    type: "bip39",
    mnemonic: joinMnemonicWords(params.mnemonic),
    ...(params.passphrase ? { passphrase: params.passphrase } : {}),
  };
  let signer: ReturnType<KeyringNamespaceAdapter["deriveAccount"]> | null = null;

  try {
    return await wallet.mutations.run(async (commit) => {
      const unlocked = wallet.vault.requireUnlocked();
      if (
        unlocked.secrets.keySources.some(
          (candidate) =>
            candidate.type === "bip39" &&
            candidate.mnemonic === source.mnemonic &&
            candidate.passphrase === source.passphrase,
        )
      ) {
        throw new WalletOperationRejectedError("key_source_already_exists");
      }

      const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
      signer = adapter.deriveAccount({
        source,
        derivationProfileId: adapter.defaultDerivationProfileId,
        derivationIndex: 0,
      });
      if (await wallet.readers.accounts.get(signer.accountId)) {
        throw new WalletOperationRejectedError("account_already_exists");
      }
      const account = createAccountRecord({
        accountId: signer.accountId,
        origin: { type: "hd", keyringId, derivationIndex: 0 },
        createAt: Date.now(),
      });
      const namespaceState = await wallet.readers.accounts.getNamespaceAccounts(params.namespace);
      const nextVault = await replaceVaultSecrets(unlocked, {
        keySources: [...unlocked.secrets.keySources, source],
      });
      await commit([
        persistenceChange.put(encryptedVaultPersistenceType, nextVault.record),
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
        ...(namespaceState
          ? []
          : [
              persistenceChange.put(accountSelectionPersistenceType, {
                namespace: params.namespace,
                accountId: account.accountId,
              }),
            ]),
      ]);
      wallet.vault.activate(nextVault);
      wallet.signers.add(signer);
      signer = null;
      wallet.autoLock.restart();
      wallet.publishChanged({ vault: true, accounts: [account.accountId], keySources: [keySourceId] });
      return account.accountId;
    });
  } catch (error) {
    clearSigner(signer);
    throw error;
  }
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
  let signer: ReturnType<KeyringNamespaceAdapter["importPrivateKey"]> | null = null;

  try {
    return await wallet.mutations.run(async (commit) => {
      const unlocked = wallet.vault.requireUnlocked();
      const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
      const source: PrivateKeySource = {
        keySourceId,
        type: "private-key",
        algorithm: adapter.privateKeyAlgorithm,
        privateKey: params.privateKey,
      };
      if (
        unlocked.secrets.keySources.some(
          (candidate) =>
            candidate.type === "private-key" &&
            candidate.algorithm === source.algorithm &&
            candidate.privateKey === source.privateKey,
        )
      ) {
        throw new WalletOperationRejectedError("key_source_already_exists");
      }
      signer = adapter.importPrivateKey(source);
      if (await wallet.readers.accounts.get(signer.accountId)) {
        throw new WalletOperationRejectedError("account_already_exists");
      }
      const account = createAccountRecord({
        accountId: signer.accountId,
        origin: { type: "private-key", keySourceId },
        createAt: Date.now(),
      });
      const namespaceState = await wallet.readers.accounts.getNamespaceAccounts(params.namespace);
      const nextVault = await replaceVaultSecrets(unlocked, {
        keySources: [...unlocked.secrets.keySources, source],
      });
      await commit([
        persistenceChange.put(encryptedVaultPersistenceType, nextVault.record),
        persistenceChange.put(keySourcePersistenceType, { keySourceId, type: "private-key" }),
        persistenceChange.put(accountPersistenceType, account),
        ...(namespaceState
          ? []
          : [
              persistenceChange.put(accountSelectionPersistenceType, {
                namespace: params.namespace,
                accountId: account.accountId,
              }),
            ]),
      ]);
      wallet.vault.activate(nextVault);
      wallet.signers.add(signer);
      signer = null;
      wallet.autoLock.restart();
      wallet.publishChanged({ vault: true, accounts: [account.accountId], keySources: [keySourceId] });
      return account.accountId;
    });
  } catch (error) {
    clearSigner(signer);
    throw error;
  }
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
    const secret = wallet.vault
      .requireUnlocked()
      .secrets.keySources.find(
        (candidate): candidate is Bip39KeySource =>
          candidate.keySourceId === params.keySourceId && candidate.type === "bip39",
      );
    if (!secret) throw new WalletRecordNotFoundError("keySource", params.keySourceId);
    if (joinMnemonicWords(params.mnemonic) !== secret.mnemonic) {
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
    const sourceRecord = await wallet.readers.keySources.get(keySourceId);
    if (!sourceRecord) throw new WalletRecordNotFoundError("keySource", keySourceId);
    const remainingSources = unlocked.secrets.keySources.filter((source) => source.keySourceId !== keySourceId);
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
    const nextVault = await replaceVaultSecrets(unlocked, { keySources: remainingSources });
    await commit([
      persistenceChange.put(encryptedVaultPersistenceType, nextVault.record),
      persistenceChange.remove(keySourcePersistenceType, keySourceId),
      ...keyrings.map((keyring) => persistenceChange.remove(hdKeyringPersistenceType, keyring.keyringId)),
      ...accountIds.map((accountId) => persistenceChange.remove(accountPersistenceType, accountId)),
      ...selectionChanges,
      ...permissionChanges,
    ]);
    wallet.vault.activate(nextVault);
    wallet.signers.remove(accountIds);
    wallet.autoLock.restart();
    wallet.publishChanged({ vault: true, accounts: accountIds, keySources: [keySourceId] });
  });
};
