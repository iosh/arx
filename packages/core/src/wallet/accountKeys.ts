import type { Accounts } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import { AccountNotFoundError } from "../accounts/errors.js";
import { KeySourceNotFoundError } from "../keyring/errors.js";
import type { Keyring } from "../keyring/Keyring.js";
import { WalletLockedError } from "./errors.js";
import type { WalletStatusReader } from "./Wallet.js";

export type AccountKeys = Readonly<{
  /** Starts a synchronous signing operation against the current session deadline. */
  withPrivateKey<T>(accountId: AccountId, use: (privateKey: Uint8Array) => T): T;
  /** The wallet command has already checked the session and verified the password inside the mutation queue. */
  exportPrivateKey(accountId: AccountId): string;
}>;

export const createAccountKeys = ({
  accounts,
  keyring,
  wallet,
}: {
  accounts: Pick<Accounts, "getGroupForMember">;
  keyring: Pick<Keyring, "withPrivateKey" | "exportPrivateKey">;
  wallet: WalletStatusReader;
}): AccountKeys => {
  const sourceFor = (accountId: AccountId) => {
    const group = accounts.getGroupForMember(accountId);
    if (!group) throw new AccountNotFoundError(accountId);
    return group.source;
  };
  return {
    withPrivateKey: (accountId, use) => {
      if (wallet.getStatus() !== "unlocked") throw new WalletLockedError();
      return keyring.withPrivateKey({ accountId, source: sourceFor(accountId) }, use);
    },
    exportPrivateKey: (accountId) => keyring.exportPrivateKey({ accountId, source: sourceFor(accountId) }),
  };
};

export const isAccountSigningUnavailableError = (error: unknown): boolean =>
  error instanceof AccountNotFoundError ||
  error instanceof WalletLockedError ||
  error instanceof KeySourceNotFoundError;
