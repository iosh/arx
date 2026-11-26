import { assert, describe, expect, it } from "vitest";
import { deriveBip39Seed } from "../../keyring/bip39.js";
import { eip155KeyringAdapter } from "./keyring.js";

const MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const PRIVATE_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("eip155KeyringAdapter", () => {
  it("derives the standard BIP44 account identity", () => {
    const seed = deriveBip39Seed(MNEMONIC);
    const privateKey = eip155KeyringAdapter.derivePrivateKey({ seed, accountIndex: 0 });
    try {
      expect(eip155KeyringAdapter.accountIdFromPrivateKey(privateKey)).toBe(
        "eip155:9858effd232b4033e47d90003d41ec34ecaeda94",
      );
    } finally {
      seed.fill(0);
      privateKey.fill(0);
    }
  });
  it("imports equivalent key text and exports one canonical representation", () => {
    for (const input of [PRIVATE_KEY, `0x${PRIVATE_KEY.toUpperCase()}`]) {
      const privateKey = eip155KeyringAdapter.parsePrivateKey(input);
      assert(privateKey);
      try {
        expect(eip155KeyringAdapter.accountIdFromPrivateKey(privateKey)).toBe(
          "eip155:fcad0b19bb29d4674531d6f115237e16afce377c",
        );
        expect(eip155KeyringAdapter.formatPrivateKey(privateKey)).toBe(`0x${PRIVATE_KEY}`);
      } finally {
        privateKey.fill(0);
      }
    }
  });
  it("returns null for invalid imported key text", () => {
    expect(eip155KeyringAdapter.parsePrivateKey("not-a-private-key")).toBeNull();
    expect(eip155KeyringAdapter.parsePrivateKey("00".repeat(32))).toBeNull();
  });
});
