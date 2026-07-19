import type { Accounts } from "../../accounts/Accounts.js";
import type { AccountId } from "../../accounts/accountId.js";
import { AccountNotFoundError } from "../../accounts/errors.js";
import { deriveBip39Seed } from "../../keyring/bip39.js";
import {
  HdKeyringNotFoundError,
  KeyringUnsupportedNamespaceError,
  KeySourceNotFoundError,
} from "../../keyring/errors.js";
import type { Keyring } from "../../keyring/Keyring.js";
import type { KeySourceId } from "../../keyring/persistence.js";
import { findKeySourceSecret, type KeySourceSecret } from "../../keyring/secrets.js";
import { WalletLockedError } from "../../wallet/errors.js";
import { type Eip155DigestSignature, signEip155HdDigest, signEip155PrivateKeyDigest } from "./keyring.js";

const EIP155_NAMESPACE = "eip155";

export type Eip155AccountSigning = Readonly<{
  signDigest(params: { accountId: AccountId; digest: Uint8Array }): Promise<Eip155DigestSignature>;
}>;

const getKeySourceSecret = (keyring: Pick<Keyring, "getSecrets">, keySourceId: KeySourceId): KeySourceSecret => {
  const secrets = keyring.getSecrets();
  if (!secrets) throw new WalletLockedError();

  const source = findKeySourceSecret(secrets, keySourceId);
  if (!source) throw new KeySourceNotFoundError(keySourceId);

  return source;
};

export const createEip155AccountSigning = ({
  keyring,
  accounts,
}: {
  keyring: Pick<Keyring, "getHdKeyring" | "getKeySource" | "getSecrets">;
  accounts: Pick<Accounts, "getAccountRecord">;
}): Eip155AccountSigning => ({
  signDigest: async ({ accountId, digest }) => {
    const account = accounts.getAccountRecord(accountId);
    if (!account) throw new AccountNotFoundError(accountId);

    if (account.origin.type === "hd") {
      const hdKeyring = keyring.getHdKeyring(account.origin.hdKeyringId);
      if (!hdKeyring) throw new HdKeyringNotFoundError(account.origin.hdKeyringId);
      if (hdKeyring.namespace !== EIP155_NAMESPACE) {
        throw new KeyringUnsupportedNamespaceError(hdKeyring.namespace);
      }

      const source = getKeySourceSecret(keyring, hdKeyring.keySourceId);
      if (source.type !== "bip39") throw new KeySourceNotFoundError(hdKeyring.keySourceId);

      const seed = await deriveBip39Seed(source);
      if (!keyring.getSecrets()) throw new WalletLockedError();

      return signEip155HdDigest({
        accountId,
        seed,
        derivationIndex: account.origin.derivationIndex,
        digest,
      });
    }

    const sourceRecord = keyring.getKeySource(account.origin.keySourceId);
    if (sourceRecord?.type !== "private-key") throw new KeySourceNotFoundError(account.origin.keySourceId);
    if (sourceRecord.namespace !== EIP155_NAMESPACE) {
      throw new KeyringUnsupportedNamespaceError(sourceRecord.namespace);
    }

    const source = getKeySourceSecret(keyring, sourceRecord.keySourceId);
    if (source.type !== "private-key") throw new KeySourceNotFoundError(sourceRecord.keySourceId);

    return signEip155PrivateKeyDigest({ accountId, privateKey: source.privateKey, digest });
  },
});
