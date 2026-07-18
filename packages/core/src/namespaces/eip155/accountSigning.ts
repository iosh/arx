import { type AccountId, getAccountIdNamespace } from "../../accounts/accountId.js";
import { AccountNotFoundError } from "../../accounts/errors.js";
import type { AccountsReader } from "../../accounts/persistence.js";
import {
  KeyringNotFoundError,
  KeyringSourceNotFoundError,
  KeyringUnsupportedNamespaceError,
} from "../../keyring/errors.js";
import type { Keyring } from "../../keyring/Keyring.js";
import type { HdKeyringsReader, KeySourcesReader } from "../../keyring/persistence.js";
import { findKeySourceSecret, type KeySourceSecret } from "../../keyring/secrets.js";
import { WalletLockedError } from "../../wallet/errors.js";
import { type Eip155DigestSignature, signEip155HdDigest, signEip155PrivateKeyDigest } from "./keyring.js";

const EIP155_NAMESPACE = "eip155";

export type Eip155AccountSigning = Readonly<{
  signDigest(params: { accountId: AccountId; digest: Uint8Array }): Promise<Eip155DigestSignature>;
}>;

type SigningMetadataReaders = Readonly<{
  accounts: Pick<AccountsReader, "get">;
  keySources: Pick<KeySourcesReader, "get">;
  hdKeyrings: Pick<HdKeyringsReader, "get">;
}>;

/** Non-secret account coordinates that can safely cross metadata awaits. */
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

const loadSigningTarget = async (
  readers: SigningMetadataReaders,
  accountId: AccountId,
): Promise<Eip155SigningTarget> => {
  if (getAccountIdNamespace(accountId) !== EIP155_NAMESPACE) throw new AccountNotFoundError(accountId);

  const account = await readers.accounts.get(accountId);
  if (!account) throw new AccountNotFoundError(accountId);

  if (account.origin.type === "hd") {
    const hdKeyring = await readers.hdKeyrings.get(account.origin.keyringId);
    if (!hdKeyring) throw new KeyringNotFoundError(account.origin.keyringId);
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

  const sourceRecord = await readers.keySources.get(account.origin.keySourceId);
  if (sourceRecord?.type !== "private-key") {
    throw new KeyringSourceNotFoundError(account.origin.keySourceId);
  }
  if (sourceRecord.namespace !== EIP155_NAMESPACE) {
    throw new KeyringUnsupportedNamespaceError(sourceRecord.namespace);
  }

  return { type: "private-key", keySourceId: account.origin.keySourceId };
};

const signTargetDigest = (
  accountId: AccountId,
  target: Eip155SigningTarget,
  source: KeySourceSecret,
  digest: Uint8Array,
): Eip155DigestSignature => {
  if (target.type === "hd") {
    if (source.type !== "bip39") throw new KeyringSourceNotFoundError(target.keySourceId);

    return signEip155HdDigest({
      accountId,
      source,
      derivationProfileId: target.derivationProfileId,
      derivationIndex: target.derivationIndex,
      digest,
    });
  }

  if (source.type !== "private-key") throw new KeyringSourceNotFoundError(target.keySourceId);
  return signEip155PrivateKeyDigest({ accountId, source, digest });
};

export const createEip155AccountSigning = (params: {
  keyring: Keyring;
  accounts: Pick<AccountsReader, "get">;
  keySources: Pick<KeySourcesReader, "get">;
  hdKeyrings: Pick<HdKeyringsReader, "get">;
}): Eip155AccountSigning => ({
  signDigest: async ({ accountId, digest }) => {
    const target = await loadSigningTarget(params, accountId);

    const secrets = params.keyring.getSecrets();
    if (!secrets) throw new WalletLockedError();

    const source = findKeySourceSecret(secrets, target.keySourceId);
    if (!source) throw new KeyringSourceNotFoundError(target.keySourceId);

    return signTargetDigest(accountId, target, source, digest);
  },
});
