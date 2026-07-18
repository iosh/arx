import type { AccountId } from "../accounts/accountId.js";
import { createAccountRecord } from "../accounts/accountRecord.js";
import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { deriveBip39Seed } from "../keyring/bip39.js";
import { HdKeyringNotFoundError, KeySourceNotFoundError } from "../keyring/errors.js";
import { getKeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import type { HdKeyringId, KeySourceId } from "../keyring/persistence.js";
import { type Bip39KeySourceSecret, findKeySourceSecret, type KeyringSecrets } from "../keyring/secrets.js";
import { persistenceChange } from "../persistence/change.js";
import { WalletOperationRejectedError } from "./errors.js";
import { permissionChangesForRemovedAccounts, selectionChangesForRemovedAccounts } from "./removal.js";
import { requireKeyringSecrets } from "./unlocked.js";
import type { WalletContext } from "./Wallet.js";

const requireBip39Source = (secrets: KeyringSecrets, keySourceId: KeySourceId): Bip39KeySourceSecret => {
  const source = findKeySourceSecret(secrets, keySourceId);
  if (source?.type !== "bip39") throw new KeySourceNotFoundError(keySourceId);
  return source;
};

export const addHdKeyring = async (
  wallet: WalletContext,
  params: { keySourceId: KeySourceId; namespace: string; derivationProfileId?: string },
): Promise<AccountId> => {
  const hdKeyringId = crypto.randomUUID();
  const createdAt = Date.now();

  return await wallet.mutations.run(async (commit) => {
    wallet.vault.requireUnlocked();
    const secrets = requireKeyringSecrets(wallet);

    const source = requireBip39Source(secrets, params.keySourceId);
    const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
    const derivationProfileId = params.derivationProfileId ?? adapter.defaultDerivationProfileId;
    const keyringUpdate = wallet.keyring.prepareAddHdKeyring({
      hdKeyringId,
      keySourceId: params.keySourceId,
      namespace: params.namespace,
      derivationProfileId,
      nextDerivationIndex: 1,
      createdAt,
    });
    const seed = await deriveBip39Seed(source);
    const identity = adapter.deriveAccount({ seed, derivationProfileId, derivationIndex: 0 });
    if (await wallet.readers.accounts.get(identity.accountId)) {
      throw new WalletOperationRejectedError("account_already_exists");
    }

    const account = createAccountRecord({
      accountId: identity.accountId,
      origin: { type: "hd", keyringId: hdKeyringId, derivationIndex: 0 },
      createAt: createdAt,
    });
    const namespaceState = await wallet.readers.accounts.getNamespaceAccounts(params.namespace);
    const selectionChanges = namespaceState
      ? []
      : [
          persistenceChange.put(accountSelectionPersistenceType, {
            namespace: params.namespace,
            accountId: account.accountId,
          }),
        ];
    const changes = [
      ...keyringUpdate.persistenceChanges,
      persistenceChange.put(accountPersistenceType, account),
      ...selectionChanges,
    ];

    await commit(changes);

    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.autoLock.restart();
    wallet.publishChanged({ accounts: [account.accountId] });
    wallet.publishKeyringChanged();

    return account.accountId;
  });
};

export const deriveHdAccount = async (wallet: WalletContext, hdKeyringId: HdKeyringId): Promise<AccountId> => {
  return await wallet.mutations.run(async (commit) => {
    wallet.vault.requireUnlocked();
    const secrets = requireKeyringSecrets(wallet);

    const hdKeyring = wallet.keyring.getHdKeyring(hdKeyringId);
    if (!hdKeyring) throw new HdKeyringNotFoundError(hdKeyringId);

    const source = requireBip39Source(secrets, hdKeyring.keySourceId);
    const seed = await deriveBip39Seed(source);
    const identity = getKeyringNamespaceAdapter(wallet.adapters, hdKeyring.namespace).deriveAccount({
      seed,
      derivationProfileId: hdKeyring.derivationProfileId,
      derivationIndex: hdKeyring.nextDerivationIndex,
    });
    const account = createAccountRecord({
      accountId: identity.accountId,
      origin: { type: "hd", keyringId: hdKeyringId, derivationIndex: hdKeyring.nextDerivationIndex },
      createAt: Date.now(),
    });
    const keyringUpdate = wallet.keyring.prepareAdvanceHdKeyring(hdKeyringId);
    const changes = [persistenceChange.put(accountPersistenceType, account), ...keyringUpdate.persistenceChanges];

    await commit(changes);

    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.autoLock.restart();
    wallet.publishChanged({ accounts: [account.accountId] });
    wallet.publishKeyringChanged();

    return account.accountId;
  });
};

export const removeHdKeyring = async (wallet: WalletContext, hdKeyringId: HdKeyringId): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    const hdKeyring = wallet.keyring.getHdKeyring(hdKeyringId);
    if (!hdKeyring) throw new HdKeyringNotFoundError(hdKeyringId);

    const accounts = await wallet.readers.accounts.listByKeyringIds([hdKeyringId]);
    const accountIds = accounts.map((account) => account.accountId);
    const selectionChanges = await selectionChangesForRemovedAccounts(wallet, accountIds);
    const permissionChanges = await permissionChangesForRemovedAccounts(wallet, accountIds);
    const keyringUpdate = wallet.keyring.prepareRemoveHdKeyring(hdKeyringId);
    const changes = [
      ...keyringUpdate.persistenceChanges,
      ...accountIds.map((accountId) => persistenceChange.remove(accountPersistenceType, accountId)),
      ...selectionChanges,
      ...permissionChanges,
    ];

    await commit(changes);

    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.autoLock.restart();
    wallet.publishChanged({ accounts: accountIds });
    wallet.publishKeyringChanged();
  });
};
