import { beforeEach, describe, expect, it } from "vitest";
import { EvmHdKeyring } from "./EvmHdKeyring.js";

const MNEMONIC = "test test test test test test test test test test test junk";
const KNOWN_ADDRESSES = ["0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"];

const MORE_KNOWN_ADDRESSES = [
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
] as const;

describe("EvmHdKeyring", () => {
  let keyring: EvmHdKeyring;

  beforeEach(() => {
    keyring = new EvmHdKeyring();
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

    const withPassphrase = new EvmHdKeyring();
    withPassphrase.loadFromMnemonic(MNEMONIC, { passphrase: "test123" });
    const derivedWithPassphrase = withPassphrase.deriveNextAccount().address;

    expect(baseline).not.toBe(derivedWithPassphrase);
  });

  it("rejects invalid mnemonic phrases", () => {
    const blank = new EvmHdKeyring();
    expect(() => blank.loadFromMnemonic("invalid words here")).toThrowError("Mnemonic phrase is invalid");
  });

  it("throws when deriving before initialization", () => {
    const blank = new EvmHdKeyring();
    expect(() => blank.deriveNextAccount()).toThrowError("Keyring has not been initialized");
  });

  it("prevents duplicate derivation for the same index", () => {
    keyring.deriveAccount(0);
    expect(() => keyring.deriveAccount(0)).toThrowError("Account already exists in this keyring");
  });

  it("throws when exporting non-existent accounts", () => {
    keyring.deriveNextAccount();
    expect(() => keyring.exportPrivateKey("0x0000000000000000000000000000000000000000")).toThrowError(
      "Requested account is not managed by this keyring",
    );
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
    const addr = KNOWN_ADDRESSES[0];
    if (!addr) throw new Error("Missing KNOWN_ADDRESSES fixture");
    expect(() => keyring.exportPrivateKey(addr)).toThrowError("Requested account is not managed by this keyring");
    expect(() => keyring.deriveNextAccount()).toThrowError("Keyring has not been initialized");
  });

  it("derives expected address vector for the first five indices", () => {
    const derived: string[] = [];

    for (let index = 0; index < MORE_KNOWN_ADDRESSES.length; index += 1) {
      const account = keyring.deriveNextAccount();
      derived.push(account.address);

      expect(account.derivationIndex).toBe(index);
      expect(account.derivationPath).toBe(`m/44'/60'/0'/0/${index}`);
      expect(account.source).toBe("derived");
    }

    expect(derived).toEqual(MORE_KNOWN_ADDRESSES);
    expect(keyring.toSnapshot().nextDerivationIndex).toBe(MORE_KNOWN_ADDRESSES.length);
  });
});
