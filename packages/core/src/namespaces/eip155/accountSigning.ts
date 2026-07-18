import { type AccountId, getAccountIdNamespace } from "../../accounts/accountId.js";
import { AccountNotFoundError } from "../../accounts/errors.js";
import type { AccountsReader } from "../../accounts/persistence.js";
import { deriveBip39Seed } from "../../keyring/bip39.js";
import {
  HdKeyringNotFoundError,
  KeyringUnsupportedNamespaceError,
  KeySourceNotFoundError,
} from "../../keyring/errors.js";
import type { Keyring } from "../../keyring/Keyring.js";
import { findKeySourceSecret, type KeySourceSecret } from "../../keyring/secrets.js";
import { WalletLockedError } from "../../wallet/errors.js";
import { type Eip155DigestSignature, signEip155HdDigest, signEip155PrivateKeyDigest } from "./keyring.js";

const EIP155_NAMESPACE = "eip155";

export type Eip155AccountSigning = Readonly<{
  signDigest(params: { accountId: AccountId; digest: Uint8Array }): Promise<Eip155DigestSignature>;
}>;

type SigningReaders = Readonly<{
  accounts: Pick<AccountsReader, "get">;
  keyring: Pick<Keyring, "getHdKeyring" | "getKeySource">;
}>;

/** Non-secret signing inputs resolved before the current unlocked secrets are read. */
type Eip155SigningTarget =
  | Readonly<{
      type: "hd";
      keySourceId: string;
      derivationProfileId: string;
      derivationIndex: number;
    }>
  | Readonly<{
      type: "private-key";
      keySourceId: string;
    }>;

const loadSigningTarget = async (readers: SigningReaders, accountId: AccountId): Promise<Eip155SigningTarget> => {
  if (getAccountIdNamespace(accountId) !== EIP155_NAMESPACE) throw new AccountNotFoundError(accountId);

  const account = await readers.accounts.get(accountId);
  if (!account) throw new AccountNotFoundError(accountId);

  if (account.origin.type === "hd") {
    const hdKeyring = readers.keyring.getHdKeyring(account.origin.keyringId);
    if (!hdKeyring) throw new HdKeyringNotFoundError(account.origin.keyringId);
    if (hdKeyring.namespace !== EIP155_NAMESPACE) {
      throw new KeyringUnsupportedNamespaceError(hdKeyring.namespace);
    }

    return {
      type: "hd",
      keySourceId: hdKeyring.keySourceId,
      derivationProfileId: hdKeyring.derivationProfileId,
      derivationIndex: account.origin.derivationIndex,
    };
  }

  const sourceRecord = readers.keyring.getKeySource(account.origin.keySourceId);
  if (sourceRecord?.type !== "private-key") {
    throw new KeySourceNotFoundError(account.origin.keySourceId);
  }
  if (sourceRecord.namespace !== EIP155_NAMESPACE) {
    throw new KeyringUnsupportedNamespaceError(sourceRecord.namespace);
  }

  return { type: "private-key", keySourceId: account.origin.keySourceId };
};

const signTargetDigest = async (
  accountId: AccountId,
  target: Eip155SigningTarget,
  source: KeySourceSecret,
  digest: Uint8Array,
): Promise<Eip155DigestSignature> => {
  if (target.type === "hd") {
    if (source.type !== "bip39") throw new KeySourceNotFoundError(target.keySourceId);

    const seed = await deriveBip39Seed(source);
    return signEip155HdDigest({
      accountId,
      seed,
      derivationProfileId: target.derivationProfileId,
      derivationIndex: target.derivationIndex,
      digest,
    });
  }

  if (source.type !== "private-key") throw new KeySourceNotFoundError(target.keySourceId);
  return signEip155PrivateKeyDigest({ accountId, source, digest });
};

export const createEip155AccountSigning = (params: {
  keyring: Keyring;
  accounts: Pick<AccountsReader, "get">;
}): Eip155AccountSigning => ({
  signDigest: async ({ accountId, digest }) => {
    const target = await loadSigningTarget(params, accountId);

    const secrets = params.keyring.getSecrets();
    if (!secrets) throw new WalletLockedError();

    const source = findKeySourceSecret(secrets, target.keySourceId);
    if (!source) throw new KeySourceNotFoundError(target.keySourceId);

    return await signTargetDigest(accountId, target, source, digest);
  },
});
