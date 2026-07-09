import { SessionLockedError } from "../session/errors.js";
import type { KeyringService } from "./service/KeyringService.js";
import type { AccountId } from "./service/types.js";

type SignDigestResult = Awaited<ReturnType<KeyringService["signDigestByAccountId"]>>;

export type AccountSigningService = {
  assertAccountUnlocked(accountId: AccountId): Promise<void>;
  signDigestByAccountId(params: { accountId: AccountId; digest: Uint8Array }): Promise<SignDigestResult>;
};

type CreateAccountSigningServiceDeps = {
  keyring: Pick<KeyringService, "waitForReady" | "hasAccountId" | "signDigestByAccountId">;
};

export const createAccountSigningService = ({ keyring }: CreateAccountSigningServiceDeps): AccountSigningService => {
  const assertAccountUnlocked: AccountSigningService["assertAccountUnlocked"] = async (accountId) => {
    await keyring.waitForReady();

    if (!keyring.hasAccountId(accountId)) {
      throw new SessionLockedError();
    }
  };

  return {
    assertAccountUnlocked,
    signDigestByAccountId: async (params) => {
      await assertAccountUnlocked(params.accountId);
      return await keyring.signDigestByAccountId(params);
    },
  };
};
