import { describe, expect, expectTypeOf, it } from "vitest";
import type { AccountRecord } from "../accounts/persistence.js";
import { accountPersistenceType } from "../accounts/persistence.js";
import { encryptedVaultPersistenceType } from "../vault/persistence.js";
import { persistenceChange } from "./change.js";

describe("persistenceChange", () => {
  it("preserves complete records and stable delete keys", () => {
    const account: AccountRecord = {
      accountId: "eip155:01",
      origin: {
        type: "hd",
        keyringId: "keyring-1",
        derivationIndex: 0,
      },
      hidden: false,
      createAt: 1,
    };

    const put = persistenceChange.put(accountPersistenceType, account);
    const keyedRemove = persistenceChange.remove(accountPersistenceType, account.accountId);
    const singletonRemove = persistenceChange.remove(encryptedVaultPersistenceType);

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
