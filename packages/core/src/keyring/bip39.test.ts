import { describe, expect, it } from "vitest";
import { parseBip39Mnemonic } from "./bip39.js";
import { KeyringInvalidMnemonicError } from "./errors.js";

const MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("BIP39 input", () => {
  it("canonicalizes imported mnemonic text", () => {
    expect(parseBip39Mnemonic(`  ${MNEMONIC.replaceAll(" ", "   ")}  `)).toBe(MNEMONIC);
  });
  it("rejects an invalid checksum", () => {
    expect(() => parseBip39Mnemonic(`${MNEMONIC.slice(0, -5)}above`)).toThrow(KeyringInvalidMnemonicError);
  });
});
