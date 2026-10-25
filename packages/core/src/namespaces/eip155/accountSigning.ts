import type { Accounts } from "../../accounts/Accounts.js";
import type { AccountId } from "../../accounts/accountId.js";
import { AccountNotFoundError } from "../../accounts/errors.js";
import { deriveBip39Seed } from "../../keyring/bip39.js";
import { KeySourceNotFoundError } from "../../keyring/errors.js";
import type { Keyring } from "../../keyring/Keyring.js";
import type { HdKeyringRecord } from "../../keyring/persistence.js";
import type { Bip39KeySourceSecret, PrivateKeySourceSecret } from "../../keyring/secrets.js";
import { WalletLockedError } from "../../wallet/errors.js";
import type { WalletStatusReader } from "../../wallet/Wallet.js";
import { type Eip155DigestSignature, signEip155HdDigest, signEip155PrivateKeyDigest } from "./keyring.js";

export type Eip155AccountSigning = Readonly<{
  signDigest(params: { accountId: AccountId; digest: Uint8Array }): Promise<Eip155DigestSignature>;
}>;

export const isAccountSigningUnavailableError = (error: unknown): boolean =>
  error instanceof AccountNotFoundError ||
  error instanceof WalletLockedError ||
  error instanceof KeySourceNotFoundError;

export const createEip155AccountSigning = ({
  keyring,
  accounts,
  wallet,
}: {
  keyring: Pick<Keyring, "getHdKeyring" | "requireKeySourceSecret">;
  accounts: Pick<Accounts, "getAccountRecord">;
  wallet: WalletStatusReader;
}): Eip155AccountSigning => ({
  signDigest: async ({ accountId, digest }) => {
    if (wallet.getStatus() !== "unlocked") throw new WalletLockedError();
    const account = accounts.getAccountRecord(accountId);
    if (!account) throw new AccountNotFoundError(accountId);

    if (account.origin.type === "hd") {
      // Complete wallet commands maintain the account's HD and source references.
      const hdKeyring = keyring.getHdKeyring(account.origin.hdKeyringId) as HdKeyringRecord;
      const source = keyring.requireKeySourceSecret(hdKeyring.keySourceId) as Bip39KeySourceSecret;

      const seed = await deriveBip39Seed(source);
      try {
        if (wallet.getStatus() !== "unlocked" || keyring.requireKeySourceSecret(hdKeyring.keySourceId) !== source) {
          throw new WalletLockedError();
        }

        return signEip155HdDigest({
          accountId,
          seed,
          derivationIndex: account.origin.derivationIndex,
          digest,
        });
      } finally {
        seed.fill(0);
      }
    }

    const source = keyring.requireKeySourceSecret(account.origin.keySourceId) as PrivateKeySourceSecret;

    return signEip155PrivateKeyDigest({ accountId, privateKey: source.privateKey, digest });
  },
});
