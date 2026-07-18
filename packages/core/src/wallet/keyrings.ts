import type { AccountId } from "../accounts/accountId.js";
import { createAccountRecord } from "../accounts/accountRecord.js";
import { accountPersistenceType, accountSelectionPersistenceType } from "../accounts/persistence.js";
import { getKeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import { hdKeyringPersistenceType, type KeySourceId } from "../keyring/persistence.js";
import { type Bip39KeySourceSecret, findKeySourceSecret, type KeyringSecrets } from "../keyring/secrets.js";
import { persistenceChange } from "../persistence/change.js";
import { WalletOperationRejectedError, WalletRecordNotFoundError } from "./errors.js";
import { permissionChangesForRemovedAccounts, selectionChangesForRemovedAccounts } from "./removal.js";
import { requireKeyringSecrets } from "./unlocked.js";
import type { WalletContext } from "./Wallet.js";

const requireBip39Source = (secrets: KeyringSecrets, keySourceId: KeySourceId): Bip39KeySourceSecret => {
  const source = findKeySourceSecret(secrets, keySourceId);
  if (source?.type !== "bip39") throw new WalletRecordNotFoundError("keySource", keySourceId);
  return source;
};

export const addHdKeyring = async (
  wallet: WalletContext,
  params: { keySourceId: KeySourceId; namespace: string; derivationProfileId?: string },
): Promise<AccountId> => {
  const keyringId = crypto.randomUUID();
  const createAt = Date.now();

  return await wallet.mutations.run(async (commit) => {
    wallet.vault.requireUnlocked();
    const secrets = requireKeyringSecrets(wallet);

    const sourceRecord = await wallet.readers.keySources.get(params.keySourceId);
    if (!sourceRecord) throw new WalletRecordNotFoundError("keySource", params.keySourceId);
    if (sourceRecord.type !== "bip39") {
      throw new WalletOperationRejectedError("hd_keyring_requires_bip39_source");
    }

    const source = requireBip39Source(secrets, params.keySourceId);
    const existingKeyrings = await wallet.readers.hdKeyrings.listByKeySourceIds([params.keySourceId]);
    const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
    const derivationProfileId = params.derivationProfileId ?? adapter.defaultDerivationProfileId;

    if (
      existingKeyrings.some(
        (keyring) => keyring.namespace === params.namespace && keyring.derivationProfileId === derivationProfileId,
      )
    ) {
      throw new WalletOperationRejectedError("namespace_keyring_already_exists");
    }

    const identity = adapter.deriveAccount({ source, derivationProfileId, derivationIndex: 0 });
    if (await wallet.readers.accounts.get(identity.accountId)) {
      throw new WalletOperationRejectedError("account_already_exists");
    }

    const account = createAccountRecord({
      accountId: identity.accountId,
      origin: { type: "hd", keyringId, derivationIndex: 0 },
      createAt,
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
      persistenceChange.put(hdKeyringPersistenceType, {
        keyringId,
        keySourceId: params.keySourceId,
        namespace: params.namespace,
        derivationProfileId,
        nextDerivationIndex: 1,
        createAt,
      }),
      persistenceChange.put(accountPersistenceType, account),
      ...selectionChanges,
    ];

    await commit(changes);

    wallet.autoLock.restart();
    wallet.publishChanged({ accounts: [account.accountId] });

    return account.accountId;
  });
};

export const deriveHdAccount = async (wallet: WalletContext, keyringId: string): Promise<AccountId> => {
  return await wallet.mutations.run(async (commit) => {
    wallet.vault.requireUnlocked();
    const secrets = requireKeyringSecrets(wallet);

    const hdKeyring = await wallet.readers.hdKeyrings.get(keyringId);
    if (!hdKeyring) throw new WalletRecordNotFoundError("hdKeyring", keyringId);

    const source = requireBip39Source(secrets, hdKeyring.keySourceId);
    const identity = getKeyringNamespaceAdapter(wallet.adapters, hdKeyring.namespace).deriveAccount({
      source,
      derivationProfileId: hdKeyring.derivationProfileId,
      derivationIndex: hdKeyring.nextDerivationIndex,
    });
    const account = createAccountRecord({
      accountId: identity.accountId,
      origin: { type: "hd", keyringId, derivationIndex: hdKeyring.nextDerivationIndex },
      createAt: Date.now(),
    });
    const nextHdKeyring = {
      ...hdKeyring,
      nextDerivationIndex: hdKeyring.nextDerivationIndex + 1,
    };
    const changes = [
      persistenceChange.put(accountPersistenceType, account),
      persistenceChange.put(hdKeyringPersistenceType, nextHdKeyring),
    ];

    await commit(changes);

    wallet.autoLock.restart();
    wallet.publishChanged({ accounts: [account.accountId] });

    return account.accountId;
  });
};

export const removeHdKeyring = async (wallet: WalletContext, keyringId: string): Promise<void> => {
  await wallet.mutations.run(async (commit) => {
    wallet.vault.requireUnlocked();
    requireKeyringSecrets(wallet);

    const hdKeyring = await wallet.readers.hdKeyrings.get(keyringId);
    if (!hdKeyring) throw new WalletRecordNotFoundError("hdKeyring", keyringId);

    const sourceHdKeyrings = await wallet.readers.hdKeyrings.listByKeySourceIds([hdKeyring.keySourceId]);
    if (sourceHdKeyrings.length === 1) {
      throw new WalletOperationRejectedError("last_keyring_requires_key_source_removal");
    }

    const accounts = await wallet.readers.accounts.listByKeyringIds([keyringId]);
    const accountIds = accounts.map((account) => account.accountId);
    const selectionChanges = await selectionChangesForRemovedAccounts(wallet, accountIds);
    const permissionChanges = await permissionChangesForRemovedAccounts(wallet, accountIds);
    const changes = [
      persistenceChange.remove(hdKeyringPersistenceType, keyringId),
      ...accountIds.map((accountId) => persistenceChange.remove(accountPersistenceType, accountId)),
      ...selectionChanges,
      ...permissionChanges,
    ];

    await commit(changes);

    wallet.autoLock.restart();
    wallet.publishChanged({ accounts: accountIds });
  });
};
