import { bytesToHex } from "@noble/hashes/utils.js";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { describe, expect, it } from "vitest";
import { deriveBip39Seed, generateBip39Mnemonic, importBip39KeySourceSecret } from "./bip39.js";
import { KeyringInvalidMnemonicError } from "./errors.js";

const OFFICIAL_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("BIP39", () => {
  it("generates an English 12-word mnemonic", () => {
    const mnemonic = generateBip39Mnemonic();

    expect(mnemonic.split(" ")).toHaveLength(12);
    expect(validateMnemonic(mnemonic, wordlist)).toBe(true);
  });

  it("canonicalizes imported mnemonic text", () => {
    const source = importBip39KeySourceSecret({
      keySourceId: "source-1",
      mnemonic: `  ${OFFICIAL_MNEMONIC.replaceAll(" ", "   ")}  `,
    });

    expect(source).toEqual({
      keySourceId: "source-1",
      type: "bip39",
      mnemonic: OFFICIAL_MNEMONIC,
    });
  });

  it("rejects an invalid checksum", () => {
    expect(() =>
      importBip39KeySourceSecret({
        keySourceId: "source-1",
        mnemonic: `${OFFICIAL_MNEMONIC.slice(0, -5)}above`,
      }),
    ).toThrow(KeyringInvalidMnemonicError);
  });

  it("derives the standard empty-passphrase seed", async () => {
    const source = importBip39KeySourceSecret({
      keySourceId: "source-1",
      mnemonic: OFFICIAL_MNEMONIC,
    });

    const seed = await deriveBip39Seed(source);

    expect(bytesToHex(seed)).toBe(
      "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4",
    );
  });
});
