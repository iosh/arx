import { describe, expect, it } from "vitest";
import { createAccountCodecRegistry, eip155Codec } from "./codec.js";

describe("accounts/addressing codec registry", () => {
  it("exposes registered codecs through registry lookup", () => {
    const registry = createAccountCodecRegistry([eip155Codec]);

    expect(registry.list().map((codec) => codec.namespace)).toEqual(["eip155"]);
    expect(registry.require("eip155")).toBe(eip155Codec);
  });

  it("throws for unsupported namespaces", () => {
    const registry = createAccountCodecRegistry();
    expect(() => registry.require("solana")).toThrow(/No account codec registered/);
  });

  it("projects accountKey-oriented helpers through the registry", () => {
    const registry = createAccountCodecRegistry([eip155Codec]);
    const accountKey = registry.toAccountKeyFromAddress({
      chainRef: "eip155:1",
      address: "0x52908400098527886E0F7030069857D2E4169EE7",
    });

    expect(accountKey).toBe("eip155:52908400098527886e0f7030069857d2e4169ee7");
    expect(registry.toCanonicalAddressFromAccountKey({ accountKey })).toBe(
      "0x52908400098527886e0f7030069857d2e4169ee7",
    );
    expect(registry.toDisplayAddressFromAccountKey({ chainRef: "eip155:1", accountKey })).toBe(
      "0x52908400098527886E0F7030069857D2E4169EE7",
    );
  });
});
