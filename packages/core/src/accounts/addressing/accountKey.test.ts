import { describe, expect, it } from "vitest";
import {
  assertAccountKeyMatchesChainRef,
  getAccountKeyNamespace,
  parseAccountKey,
  toAccountKeyFromAddress,
  toCanonicalAddressFromAccountKey,
  toDisplayAddressFromAccountKey,
} from "./accountKey.js";
import { createAccountCodecRegistry, eip155Codec } from "./codec.js";

const chainRef = "eip155:1" as const;
const accountCodecs = createAccountCodecRegistry([eip155Codec]);

describe("accounts/addressing accountKey helpers", () => {
  it("derives accountKey from address input", () => {
    const accountKey = toAccountKeyFromAddress({
      chainRef,
      address: "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd",
      accountCodecs,
    });

    expect(accountKey).toBe("eip155:aabbccddeeff00112233445566778899aabbccdd");
    expect(accountKey).not.toBe("0xAaBbCcDdEeFf00112233445566778899AaBbCcDd");
    expect(accountKey).not.toBe("eip155:1:0xaabbccddeeff00112233445566778899aabbccdd");
    expect(getAccountKeyNamespace(accountKey)).toBe("eip155");
    expect(parseAccountKey(accountKey)).toEqual({
      namespace: "eip155",
      payloadHex: "aabbccddeeff00112233445566778899aabbccdd",
    });
  });

  it("projects canonical and display addresses from accountKey", () => {
    const accountKey = "eip155:52908400098527886e0f7030069857d2e4169ee7" as const;

    expect(
      toCanonicalAddressFromAccountKey({
        accountKey,
        accountCodecs,
      }),
    ).toBe("0x52908400098527886e0f7030069857d2e4169ee7");

    expect(
      toDisplayAddressFromAccountKey({
        chainRef,
        accountKey,
        accountCodecs,
      }),
    ).toBe("0x52908400098527886E0F7030069857D2E4169EE7");
  });

  it("rejects mismatched chainRef and accountKey namespaces", () => {
    expect(() =>
      assertAccountKeyMatchesChainRef({
        chainRef: "conflux:cfx",
        accountKey: "eip155:aabbccddeeff00112233445566778899aabbccdd",
      }),
    ).toThrow(/AccountKey namespace mismatch/i);
  });
});
