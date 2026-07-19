import { accountsChangedFromUpdate } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import type { AccountRecord } from "../accounts/persistence.js";
import { deriveBip39Seed } from "../keyring/bip39.js";
import { HdKeyringNotFoundError, KeySourceNotFoundError } from "../keyring/errors.js";
import { getKeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import type { HdKeyringId, KeySourceId } from "../keyring/persistence.js";
import { type Bip39KeySourceSecret, findKeySourceSecret, type KeyringSecrets } from "../keyring/secrets.js";
import { requireKeyringSecrets } from "./unlocked.js";
import type { AddHdKeyringInput, WalletContext } from "./Wallet.js";

const requireBip39Source = (secrets: KeyringSecrets, keySourceId: KeySourceId): Bip39KeySourceSecret => {
  const source = findKeySourceSecret(secrets, keySourceId);
  if (source?.type !== "bip39") throw new KeySourceNotFoundError(keySourceId);
  return source;
};

export const addHdKeyring = async (
  wallet: WalletContext,
  params: AddHdKeyringInput,
): Promise<{ hdKeyringId: HdKeyringId; accountId: AccountId }> => {
  const hdKeyringId = crypto.randomUUID();

  return await wallet.mutations.run(async (commit) => {
    const secrets = requireKeyringSecrets(wallet);
    const createdAt = wallet.time.now();
    const keyringUpdate = wallet.keyring.prepareAddHdKeyring({
      hdKeyringId,
      keySourceId: params.keySourceId,
      namespace: params.namespace,
      nextDerivationIndex: 1,
      createdAt,
    });
    const source = requireBip39Source(secrets, params.keySourceId);
    const adapter = getKeyringNamespaceAdapter(wallet.adapters, params.namespace);
    const seed = await deriveBip39Seed(source);
    const accountId = adapter.deriveHdAccountId({ seed, derivationIndex: 0 });
    const account: Omit<AccountRecord, "hidden"> = {
      accountId,
      origin: { type: "hd", hdKeyringId, derivationIndex: 0 },
      createdAt,
    };
    const accountsUpdate = wallet.accounts.prepareAddAccount(account);
    const changes = [...keyringUpdate.persistenceChanges, ...accountsUpdate.persistenceChanges];

    await commit(changes);

    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.accounts.applyCommittedUpdate(accountsUpdate);
    wallet.autoLock.recordActivity();
    wallet.publishKeyringChanged();
    wallet.publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));

    return { hdKeyringId, accountId };
  });
};

export const deriveHdAccount = async (wallet: WalletContext, hdKeyringId: HdKeyringId): Promise<AccountId> => {
  return await wallet.mutations.run(async (commit) => {
    const secrets = requireKeyringSecrets(wallet);

    const hdKeyring = wallet.keyring.getHdKeyring(hdKeyringId);
    if (!hdKeyring) throw new HdKeyringNotFoundError(hdKeyringId);

    const source = requireBip39Source(secrets, hdKeyring.keySourceId);
    const seed = await deriveBip39Seed(source);
    const accountId = getKeyringNamespaceAdapter(wallet.adapters, hdKeyring.namespace).deriveHdAccountId({
      seed,
      derivationIndex: hdKeyring.nextDerivationIndex,
    });
    const account: Omit<AccountRecord, "hidden"> = {
      accountId,
      origin: { type: "hd", hdKeyringId, derivationIndex: hdKeyring.nextDerivationIndex },
      createdAt: wallet.time.now(),
    };
    const keyringUpdate = wallet.keyring.prepareAdvanceHdKeyring(hdKeyringId);
    const accountsUpdate = wallet.accounts.prepareAddAccount(account);
    const changes = [...accountsUpdate.persistenceChanges, ...keyringUpdate.persistenceChanges];

    await commit(changes);

    wallet.keyring.applyCommittedUpdate(keyringUpdate);
    wallet.accounts.applyCommittedUpdate(accountsUpdate);
    wallet.autoLock.recordActivity();
    wallet.publishKeyringChanged();
    wallet.publishAccountsChanged(accountsChangedFromUpdate(accountsUpdate));

    return account.accountId;
  });
};
