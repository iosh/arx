import { describe, expect, it } from "vitest";
import { deriveBip39Seed } from "../../keyring/bip39.js";
import { Eip155InvalidPrivateKeyError } from "./errors.js";
import { eip155KeyringAdapter } from "./keyring.js";

const MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("eip155KeyringAdapter", () => {
  it("derives the standard BIP-44 account identity", async () => {
    const seed = await deriveBip39Seed({
      keySourceId: "source-1",
      type: "bip39",
      mnemonic: MNEMONIC,
    });

    expect(
      eip155KeyringAdapter.deriveHdAccountId({
        seed,
        derivationIndex: 0,
      }),
    ).toBe("eip155:9858effd232b4033e47d90003d41ec34ecaeda94");
  });

  it("derives an account identity from an imported private key", () => {
    expect(
      eip155KeyringAdapter.accountIdFromPrivateKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
    ).toBe("eip155:fcad0b19bb29d4674531d6f115237e16afce377c");
  });

  it("rejects invalid secp256k1 private keys", () => {
    expect(() => eip155KeyringAdapter.accountIdFromPrivateKey("not-a-private-key")).toThrow(
      Eip155InvalidPrivateKeyError,
    );
    expect(() => eip155KeyringAdapter.accountIdFromPrivateKey("00".repeat(32))).toThrow(Eip155InvalidPrivateKeyError);
  });
});
