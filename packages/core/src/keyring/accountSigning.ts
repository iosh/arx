import type { AccountId } from "../accounts/addressing/accountId.js";
import { WalletLockedError } from "../wallet/errors.js";
import type { Wallet } from "../wallet/Wallet.js";

type SignDigestResult = Readonly<{ r: bigint; s: bigint; yParity: number; bytes: Uint8Array }>;

export type AccountSigningService = {
  assertAccountUnlocked(accountId: AccountId): Promise<void>;
  signDigestByAccountId(params: { accountId: AccountId; digest: Uint8Array }): Promise<SignDigestResult>;
};

export const createWalletAccountSigning = (wallet: Pick<Wallet, "getSigner">): AccountSigningService => ({
  assertAccountUnlocked: async (accountId) => {
    if (!wallet.getSigner(accountId)) throw new WalletLockedError();
  },
  signDigestByAccountId: async ({ accountId, digest }) => {
    const signer = wallet.getSigner(accountId);
    if (!signer) throw new WalletLockedError();
    return await signer.signDigest(digest);
  },
});
