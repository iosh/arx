import { describe, expect, it } from "vitest";
import { getAccountCodec } from "./builtin.js";
import { createAccountCodecRegistry, eip155Codec } from "./codec.js";

describe("accounts/addressing codec registry", () => {
  it("exposes registered codecs through registry lookup", () => {
    const registry = createAccountCodecRegistry([eip155Codec]);

    expect(registry.list().map((codec) => codec.namespace)).toEqual(["eip155"]);
    expect(registry.require("eip155")).toBe(eip155Codec);
    expect(getAccountCodec("eip155")).toBe(eip155Codec);
  });

  it("throws for unsupported namespaces", () => {
    const registry = createAccountCodecRegistry();
    expect(() => registry.require("solana")).toThrow(/No account codec registered/);
  });
});
