import { describe, expect, it } from "vitest";
import { ACCOUNT_CODECS, getAccountCodec } from "./codec.js";

describe("accounts/addressing codec registry", () => {
  it("exposes registered codecs through a stable registry", () => {
    expect(Object.keys(ACCOUNT_CODECS)).toEqual(["eip155"]);
    expect(getAccountCodec("eip155")).toBe(ACCOUNT_CODECS.eip155);
  });

  it("throws for unsupported namespaces", () => {
    expect(() => getAccountCodec("solana")).toThrow(/No account codec registered/);
  });
});
