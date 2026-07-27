import { describe, expect, expectTypeOf, it } from "vitest";
import type { AccountRecord } from "../accounts/persistence.js";
import { accountWrites } from "../accounts/persistence.js";
import { encryptedVaultWrites } from "../vault/persistence.js";

describe("persistence writes", () => {
  it("preserves complete records and stable delete keys", () => {
    const account: AccountRecord = {
      accountId: "eip155:01",
      origin: {
        type: "hd",
        hdKeyringId: "keyring-1",
        derivationIndex: 0,
      },
      hidden: false,
      createdAt: 1,
    };

    const put = accountWrites.put(account);
    const keyedRemove = accountWrites.remove(account.accountId);
    const singletonRemove = encryptedVaultWrites.remove();

    expect(put).toEqual({
      persistenceType: "account",
      operation: "put",
      value: account,
    });
    expect(put.value).toBe(account);
    expect(keyedRemove).toEqual({
      persistenceType: "account",
      operation: "remove",
      key: account.accountId,
    });
    expect(singletonRemove).toEqual({
      persistenceType: "encryptedVault",
      operation: "remove",
    });

    expectTypeOf(put.value).toEqualTypeOf<AccountRecord>();
    expectTypeOf(keyedRemove.key).toEqualTypeOf<string>();
    expectTypeOf(singletonRemove).not.toHaveProperty("key");
  });
});
