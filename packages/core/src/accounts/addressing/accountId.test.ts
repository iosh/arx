import { describe, expect, it } from "vitest";
import {
  accountIdFromChainAddress,
  canonicalChainAddressFromAccountId,
  displayChainAddressFromAccountId,
  getAccountIdNamespace,
  parseAccountId,
} from "./accountId.js";
import { buildAccountAddressingByNamespace, eip155AccountAddressing } from "./addressing.js";

const chainRef = "eip155:1" as const;
const accountAddressing = buildAccountAddressingByNamespace([eip155AccountAddressing]);

describe("accounts/addressing accountId helpers", () => {
  it("derives accountId from address input", () => {
    const accountId = accountIdFromChainAddress({
      chainRef,
      address: "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd",
      accountAddressing,
    });

    expect(accountId).toBe("eip155:aabbccddeeff00112233445566778899aabbccdd");
    expect(accountId).not.toBe("0xAaBbCcDdEeFf00112233445566778899AaBbCcDd");
    expect(accountId).not.toBe("eip155:1:0xaabbccddeeff00112233445566778899aabbccdd");
    expect(getAccountIdNamespace(accountId)).toBe("eip155");
    expect(parseAccountId(accountId)).toEqual({
      namespace: "eip155",
      payloadHex: "aabbccddeeff00112233445566778899aabbccdd",
    });
  });

  it("projects canonical and display addresses from accountId", () => {
    const accountId = "eip155:52908400098527886e0f7030069857d2e4169ee7" as const;

    expect(
      canonicalChainAddressFromAccountId({
        chainRef,
        accountId,
        accountAddressing,
      }),
    ).toBe("0x52908400098527886e0f7030069857d2e4169ee7");

    expect(
      displayChainAddressFromAccountId({
        chainRef,
        accountId,
        accountAddressing,
      }),
    ).toBe("0x52908400098527886E0F7030069857D2E4169EE7");
  });
});
