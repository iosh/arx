import { describe, expect, it } from "vitest";
import { toAccountKeyFromAddress } from "./accountKey.js";
import { toAccountRefFromAccountKey } from "./accountRef.js";
import { createAccountCodecRegistry, eip155Codec } from "./codec.js";

const accountCodecs = createAccountCodecRegistry([eip155Codec]);

describe("accounts/addressing accountRef helpers", () => {
  it("derives accountRef from accountKey via canonical address projection", () => {
    const accountKey = toAccountKeyFromAddress({
      chainRef: "eip155:1",
      address: "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd",
      accountCodecs,
    });

    expect(
      toAccountRefFromAccountKey({
        chainRef: "eip155:1",
        accountKey,
        accountCodecs,
      }),
    ).toBe("eip155:1:0xaabbccddeeff00112233445566778899aabbccdd");
  });

  it("encodes chain-local separators in canonical addresses", () => {
    expect(
      toAccountRefFromAccountKey({
        chainRef: "conflux:cfx",
        accountKey: "conflux:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        accountCodecs: {
          require() {
            return {
              namespace: "conflux",
              toCanonicalAddress: () => ({ namespace: "conflux", bytes: Uint8Array.from([]) }),
              toCanonicalString: () => "cfx:aarc9abycue0hhzgyrr53m6cxedgccrmmyybjgh4xg",
              toDisplayAddress: () => "cfx:aarc9abycue0hhzgyrr53m6cxedgccrmmyybjgh4xg",
              toAccountKey: () => "conflux:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              fromAccountKey: () => ({ namespace: "conflux", bytes: Uint8Array.from([]) }),
            };
          },
        },
      }),
    ).toBe("conflux:cfx:cfx%3Aaarc9abycue0hhzgyrr53m6cxedgccrmmyybjgh4xg");
  });

  it("rejects mismatched chainRef and accountKey namespaces", () => {
    expect(() =>
      toAccountRefFromAccountKey({
        chainRef: "conflux:cfx",
        accountKey: "eip155:aabbccddeeff00112233445566778899aabbccdd",
        accountCodecs,
      }),
    ).toThrow(/AccountKey namespace mismatch/i);
  });
});
