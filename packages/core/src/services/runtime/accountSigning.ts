import type { KeyringService } from "../../runtime/keyring/KeyringService.js";
import type { AccountKey } from "../../runtime/keyring/types.js";
import { SessionLockedError } from "../../runtime/session/errors.js";

type SignDigestResult = Awaited<ReturnType<KeyringService["signDigestByAccountKey"]>>;

export type AccountSigningService = {
  assertAccountUnlocked(accountKey: AccountKey): Promise<void>;
  signDigestByAccountKey(params: { accountKey: AccountKey; digest: Uint8Array }): Promise<SignDigestResult>;
};

type CreateAccountSigningServiceDeps = {
  keyring: Pick<KeyringService, "waitForReady" | "hasAccountKey" | "signDigestByAccountKey">;
};

export const createAccountSigningService = ({ keyring }: CreateAccountSigningServiceDeps): AccountSigningService => {
  const assertAccountUnlocked: AccountSigningService["assertAccountUnlocked"] = async (accountKey) => {
    await keyring.waitForReady();

    if (!keyring.hasAccountKey(accountKey)) {
      throw new SessionLockedError();
    }
  };

  return {
    assertAccountUnlocked,
    signDigestByAccountKey: async (params) => {
      await assertAccountUnlocked(params.accountKey);
      return await keyring.signDigestByAccountKey(params);
    },
  };
};
