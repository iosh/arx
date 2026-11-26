import type { AccountId } from "../../accounts/accountId.js";
import type { AccountKeys } from "../../wallet/accountKeys.js";
import { type Eip155DigestSignature, signEip155Digest } from "./keyring.js";

export type Eip155AccountSigning = Readonly<{
  signDigest(params: { accountId: AccountId; digest: Uint8Array }): Promise<Eip155DigestSignature>;
}>;

export const createEip155AccountSigning = (keys: Pick<AccountKeys, "withPrivateKey">): Eip155AccountSigning => ({
  signDigest: async ({ accountId, digest }) =>
    keys.withPrivateKey(accountId, (privateKey) => signEip155Digest({ privateKey, digest })),
});
