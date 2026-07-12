import { describe, expect, it } from "vitest";
import { eip155AccountAddressCodec } from "../namespaces/eip155/accountAddressCodec.js";
import { getAccountAddressCodec } from "./accountAddressCodec.js";

describe("AccountAddressCodec", () => {
  it("finds a codec by namespace", () => {
    const accountAddressCodecs = new Map([["eip155", eip155AccountAddressCodec]]);

    expect(getAccountAddressCodec(accountAddressCodecs, "eip155")).toBe(eip155AccountAddressCodec);
    expect(() => getAccountAddressCodec(accountAddressCodecs, "solana")).toThrow(
      /No account address codec is available/,
    );
  });
});
