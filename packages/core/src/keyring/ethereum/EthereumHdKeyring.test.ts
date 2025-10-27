import { beforeEach, describe, expect, it } from "vitest";
import { EthereumHdKeyring } from "./EthereumHdKeyring.js";

const MNEMONIC = "test test test test test test test test test test test junk";
const KNOWN_ADDRESSES = ["0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"];

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

describe("EthereumHdKeyring", () => {
  let keyring: EthereumHdKeyring;

  beforeEach(() => {
    keyring = new EthereumHdKeyring();
    keyring.loadFromMnemonic(MNEMONIC);
  });

  it("derives deterministic accounts and tracks next index", () => {
    const first = keyring.deriveNextAccount();
    const second = keyring.deriveNextAccount();

    expect(first.address).toBe(KNOWN_ADDRESSES[0]);
    expect(first.derivationIndex).toBe(0);
    expect(first.source).toBe("derived");

    expect(second.address).toBe(KNOWN_ADDRESSES[1]);
    expect(second.derivationIndex).toBe(1);
    expect(keyring.toSnapshot().nextDerivationIndex).toBe(2);
  });

  it("derives different accounts when using a passphrase", () => {
    const baseline = keyring.deriveNextAccount().address;

    const withPassphrase = new EthereumHdKeyring();
    withPassphrase.loadFromMnemonic(MNEMONIC, { passphrase: "test123" });
    const derivedWithPassphrase = withPassphrase.deriveNextAccount().address;

    expect(baseline).not.toBe(derivedWithPassphrase);
  });

  it("rejects invalid mnemonic phrases", () => {
    const blank = new EthereumHdKeyring();
    expect(() => blank.loadFromMnemonic("invalid words here")).toThrowError("Mnemonic phrase is invalid");
  });

  it("throws when deriving before initialization", () => {
    const blank = new EthereumHdKeyring();
    expect(() => blank.deriveNextAccount()).toThrowError("Keyring has not been initialized");
  });

  it("prevents duplicate derivation for the same index", () => {
    keyring.deriveAccount(0);
    expect(() => keyring.deriveAccount(0)).toThrowError("Account already exists in this keyring");
  });

  it("imports raw private keys and exports the same secret", () => {
    const privateKey = "0x4c0883a69102937d6231471b5dbb6204fe5129617082794ae5a3dfcc5a7b5d14";
    const imported = keyring.importAccount(privateKey);

    expect(imported.source).toBe("imported");
    expect(imported.derivationPath).toBeNull();

    const exported = keyring.exportPrivateKey(imported.address);
    expect(toHex(exported)).toBe(privateKey.replace(/^0x/, "").toLowerCase());
  });

  it("throws when exporting non-existent accounts", () => {
    keyring.deriveNextAccount();
    expect(() => keyring.exportPrivateKey("0x0000000000000000000000000000000000000000")).toThrowError(
      "Requested account is not managed by this keyring",
    );
  });

  it("rejects invalid private key formats", () => {
    expect(() => keyring.importAccount("0xshort")).toThrowError("Private key must be a 32-byte hex value");
    expect(() => keyring.importAccount("")).toThrowError("Private key must be a 32-byte hex value");
    expect(() => keyring.importAccount("not hex at all")).toThrowError("Private key must be a 32-byte hex value");
  });

  it("hydrates from snapshot after clearing state", () => {
    const derived = [keyring.deriveNextAccount(), keyring.deriveNextAccount()];
    const snapshot = keyring.toSnapshot();

    keyring.clear();
    keyring.loadFromMnemonic(MNEMONIC);
    keyring.hydrate(snapshot);

    expect(keyring.getAccounts()).toEqual(derived);
    expect(keyring.toSnapshot().nextDerivationIndex).toBe(snapshot.nextDerivationIndex);
  });

  it("clears secrets and blocks further operations once locked", () => {
    keyring.deriveNextAccount();
    keyring.clear();

    expect(keyring.getAccounts()).toHaveLength(0);
    expect(() => keyring.exportPrivateKey(KNOWN_ADDRESSES[0]!)).toThrowError(
      "Requested account is not managed by this keyring",
    );
    expect(() => keyring.deriveNextAccount()).toThrowError("Keyring has not been initialized");
  });
});
