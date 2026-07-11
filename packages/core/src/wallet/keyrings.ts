import { createAccountRecord } from "../accounts/accountRecord.js";
import type { AccountId } from "../accounts/addressing/accountId.js";
import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { getKeyringNamespaceAdapter, type KeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import { hdKeyringPersistenceType, type KeySourceId } from "../keyring/persistence.js";
import type { UnlockedSigner } from "../keyring/UnlockedSigners.js";
import { persistenceChange } from "../persistence/change.js";
import type { Bip39KeySource } from "../vault/secrets.js";
import { WalletOperationRejectedError, WalletRecordNotFoundError } from "./errors.js";
import { permissionChangesForRemovedAccounts, selectionChangesForRemovedAccounts } from "./removal.js";
import type { WalletContext } from "./Wallet.js";

const clearSigner = (signer: UnlockedSigner | null): void => signer?.clear();

export const addHdKeyring = async (
  wallet: WalletContext,
  params: { keySourceId: KeySourceId; namespace: string; derivationProfileId?: string },
): Promise<AccountId> => {
  const keyringId = crypto.randomUUID();
  let signer: ReturnType<KeyringNamespaceAdapter["deriveAccount"]> | null = null;

  try {
    return await wallet.mutations.run(async (commit) => {
      const unlocked = wallet.vault.requireUnlocked();
      const sourceRecord = await wallet.readers.keySources.get(params.keySourceId);
      if (!sourceRecord) throw new WalletRecordNotFoundError("keySource", params.keySourceId);
      if (sourceRecord.type !== "bip39") {
        throw new WalletOperationRejectedError("hd_keyring_requires_bip39_source");
      }
      const source = unlocked.secrets.keySources.find(
        (candidate): candidate is Bip39KeySource =>
          candidate.keySourceId === params.keySourceId && candidate.type === "bip39",
      );
      if (!source) throw new WalletRecordNotFoundError("keySource", params.keySourceId);
      const existingKeyrings = await wallet.readers.hdKeyrings.listByKeySourceIds([params.keySourceId]);
      if (existingKeyrings.some((keyring) => keyring.namespace === params.namespace)) {
        throw new WalletOperationRejectedError("namespace_keyring_already_exists");
      }
      const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
      const derivationProfileId = params.derivationProfileId ?? adapter.defaultDerivationProfileId;
      signer = adapter.deriveAccount({ source, derivationProfileId, derivationIndex: 0 });
      if (await wallet.readers.accounts.get(signer.accountId)) {
        throw new WalletOperationRejectedError("account_already_exists");
      }
      const account = createAccountRecord({
        accountId: signer.accountId,
        origin: { type: "hd", keyringId, derivationIndex: 0 },
        createAt: Date.now(),
      });
      const namespaceState = await wallet.readers.accounts.getNamespaceAccounts(params.namespace);
      await commit([
        persistenceChange.put(hdKeyringPersistenceType, {
          keyringId,
          keySourceId: params.keySourceId,
          namespace: params.namespace,
          derivationProfileId,
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
      wallet.signers.add(signer);
      signer = null;
      wallet.autoLock.restart();
      wallet.publishChanged({ accounts: [account.accountId] });
      return account.accountId;
    });
  } catch (error) {
    clearSigner(signer);
    throw error;
  }
};

export const deriveHdAccount = async (wallet: WalletContext, keyringId: string): Promise<AccountId> => {
  let signer: ReturnType<KeyringNamespaceAdapter["deriveAccount"]> | null = null;
  try {
    return await wallet.mutations.run(async (commit) => {
      const unlocked = wallet.vault.requireUnlocked();
      const keyring = await wallet.readers.hdKeyrings.get(keyringId);
      if (!keyring) throw new WalletRecordNotFoundError("hdKeyring", keyringId);
      const source = unlocked.secrets.keySources.find(
        (candidate): candidate is Bip39KeySource =>
          candidate.keySourceId === keyring.keySourceId && candidate.type === "bip39",
      );
      if (!source) throw new WalletRecordNotFoundError("keySource", keyring.keySourceId);
      signer = getKeyringNamespaceAdapter(wallet.adapters, keyring.namespace).deriveAccount({
        source,
        derivationProfileId: keyring.derivationProfileId,
        derivationIndex: keyring.nextDerivationIndex,
      });
      const account = createAccountRecord({
        accountId: signer.accountId,
        origin: { type: "hd", keyringId, derivationIndex: keyring.nextDerivationIndex },
        createAt: Date.now(),
      });
      await commit([
        persistenceChange.put(accountPersistenceType, account),
        persistenceChange.put(hdKeyringPersistenceType, {
          ...keyring,
          nextDerivationIndex: keyring.nextDerivationIndex + 1,
        }),
      ]);
      wallet.signers.add(signer);
      signer = null;
      wallet.autoLock.restart();
      wallet.publishChanged({ accounts: [account.accountId] });
      return account.accountId;
    });
  } catch (error) {
    clearSigner(signer);
    throw error;
  }
};

export const removeHdKeyring = async (wallet: WalletContext, keyringId: string): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    wallet.vault.requireUnlocked();
    const keyring = await wallet.readers.hdKeyrings.get(keyringId);
    if (!keyring) throw new WalletRecordNotFoundError("hdKeyring", keyringId);
    const sourceKeyrings = await wallet.readers.hdKeyrings.listByKeySourceIds([keyring.keySourceId]);
    if (sourceKeyrings.length === 1) {
      throw new WalletOperationRejectedError("last_keyring_requires_key_source_removal");
    }
    const accounts = await wallet.readers.accounts.listByKeyringIds([keyringId]);
    const accountIds = accounts.map((account) => account.accountId);
    const selectionChanges = await selectionChangesForRemovedAccounts(wallet, accountIds);
    const permissionChanges = await permissionChangesForRemovedAccounts(wallet, accountIds);
    await commit([
      persistenceChange.remove(hdKeyringPersistenceType, keyringId),
      ...accountIds.map((accountId) => persistenceChange.remove(accountPersistenceType, accountId)),
      ...selectionChanges,
      ...permissionChanges,
    ]);
    wallet.signers.remove(accountIds);
    wallet.autoLock.restart();
    wallet.publishChanged({ accounts: accountIds });
  });
};
