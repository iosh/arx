import { describe, expect, it } from "vitest";
import { toAccountIdFromAddress, toCanonicalAddressFromAccountId, toDisplayAddressFromAccountId } from "./accountId.js";
import { createAccountCodecRegistry, eip155Codec } from "./codec.js";

const chainRef = "eip155:1" as const;
const accountCodecs = createAccountCodecRegistry([eip155Codec]);

describe("accounts/addressing accountId helpers", () => {
  it("derives stable accountId from address input", () => {
    expect(
      toAccountIdFromAddress({
        chainRef,
        address: "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd",
        accountCodecs,
      }),
    ).toBe("eip155:aabbccddeeff00112233445566778899aabbccdd");
  });

  it("converts accountId back to canonical chain address", () => {
    expect(
      toCanonicalAddressFromAccountId({
        accountId: "eip155:aabbccddeeff00112233445566778899aabbccdd",
        accountCodecs,
      }),
    ).toBe("0xaabbccddeeff00112233445566778899aabbccdd");
  });

  it("converts accountId to display address", () => {
    expect(
      toDisplayAddressFromAccountId({
        chainRef,
        accountId: "eip155:52908400098527886e0f7030069857d2e4169ee7",
        accountCodecs,
      }),
    ).toBe("0x52908400098527886E0F7030069857D2E4169EE7");
  });

  it("rejects accountIds for unsupported namespaces", () => {
    expect(() =>
      toCanonicalAddressFromAccountId({
        accountId: "solana:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        accountCodecs,
      }),
    ).toThrow(/No account codec registered/i);
  });
});
