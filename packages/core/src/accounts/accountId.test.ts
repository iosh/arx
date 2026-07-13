import { describe, expect, it } from "vitest";
import { eip155AccountAddressCodec } from "../namespaces/eip155/accountAddressCodec.js";
import { accountIdFromAddress, addressFromAccountId, getAccountIdNamespace, parseAccountId } from "./accountId.js";

const chainRef = "eip155:1" as const;
const accountAddressCodecs = new Map([["eip155", eip155AccountAddressCodec]]);

describe("accountId", () => {
  it("derives accountId from address input", () => {
    const accountId = accountIdFromAddress({
      chainRef,
      address: "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd",
      accountAddressCodecs,
    });

    expect(accountId).toBe("eip155:aabbccddeeff00112233445566778899aabbccdd");
    expect(accountId).not.toBe("0xAaBbCcDdEeFf00112233445566778899AaBbCcDd");
    expect(accountId).not.toBe("eip155:1:0xaabbccddeeff00112233445566778899aabbccdd");
    expect(getAccountIdNamespace(accountId)).toBe("eip155");
    expect(parseAccountId(accountId)).toEqual({
      namespace: "eip155",
      payload: "aabbccddeeff00112233445566778899aabbccdd",
    });
  });

  it("restores the canonical address from accountId", () => {
    const accountId = "eip155:52908400098527886e0f7030069857d2e4169ee7" as const;

    expect(
      addressFromAccountId({
        chainRef,
        accountId,
        accountAddressCodecs,
      }),
    ).toBe("0x52908400098527886e0f7030069857d2e4169ee7");
  });
});
