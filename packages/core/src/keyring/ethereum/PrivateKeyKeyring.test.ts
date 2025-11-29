import { describe, expect, it } from "vitest";
import { keyringErrors } from "../../errors/keyring.js";
import type { KeyringAccount, SimpleKeyringSnapshot } from "../types.js";
import { PrivateKeyKeyring } from "./PrivateKeyKeyring.js";

const PK = "0xe4489a71aa574af4c240b10161854d43981965b4ab8c4fbc393401a508e11d00";
const PK2 = "0xd05a5b7b99209028f6550ef16790697515273d4252f9445cf5c7f1b74df32659";

const expectCode = (fn: () => unknown, code: string) => {
  try {
    fn();
    throw new Error("Expected function to throw");
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
};

describe("PrivateKeyKeyring", () => {
  it("imports and exposes account", () => {
    const keyring = new PrivateKeyKeyring();
    keyring.loadFromPrivateKey(PK);

    const accounts = keyring.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(keyring.hasAccount(accounts[0]!.address)).toBe(true);
    const exported = keyring.exportPrivateKey(accounts[0]!.address);
    expect(exported).toBeInstanceOf(Uint8Array);
  });

  it("replaces secret when importing again", () => {
    const keyring = new PrivateKeyKeyring();
    keyring.loadFromPrivateKey(PK);
    const first = keyring.getAccounts()[0]!.address;

    keyring.loadFromPrivateKey(PK2); // should overwrite
    const [account] = keyring.getAccounts();

    expect(account!.address).not.toBe(first);
    expect(() => keyring.exportPrivateKey(account!.address)).not.toThrow();
  });

  it("remove clears account", () => {
    const keyring = new PrivateKeyKeyring();
    keyring.loadFromPrivateKey(PK);
    const [account] = keyring.getAccounts();
    keyring.removeAccount(account!.address);
    expect(keyring.getAccounts()).toHaveLength(0);
    expectCode(() => keyring.removeAccount(account!.address), keyringErrors.accountNotFound().code);
  });

  it("hydrates only when secret is loaded and addresses match", () => {
    const keyring = new PrivateKeyKeyring();
    const snapshot: SimpleKeyringSnapshot<KeyringAccount<string>> = {
      type: "simple",
      account: {
        address: "0xabc0000000000000000000000000000000000000",
        derivationPath: null,
        derivationIndex: null,
        source: "imported",
      },
    };
    expectCode(() => keyring.hydrate(snapshot), keyringErrors.secretUnavailable().code);

    keyring.loadFromPrivateKey(PK);
    const goodSnapshot = keyring.toSnapshot();
    expect(() => keyring.hydrate(goodSnapshot)).not.toThrow();

    const badSnapshot: SimpleKeyringSnapshot<KeyringAccount<string>> = {
      type: "simple",
      account: {
        address: "0x0000000000000000000000000000000000000000",
        derivationPath: null,
        derivationIndex: null,
        source: "imported",
      },
    };
    expectCode(() => keyring.hydrate(badSnapshot), keyringErrors.secretUnavailable().code);

    keyring.hydrate({ type: "simple", account: null });
    expect(keyring.getAccounts()).toHaveLength(0);
  });

  it("derive methods are unsupported", () => {
    const keyring = new PrivateKeyKeyring();
    expectCode(() => keyring.deriveNextAccount(), keyringErrors.indexOutOfRange().code);
    expectCode(() => keyring.deriveAccount(), keyringErrors.indexOutOfRange().code);
  });

  it("hydrates with loaded secret and rejects mismatches", () => {
    const keyring = new PrivateKeyKeyring();

    expectCode(
      () =>
        keyring.hydrate({
          type: "simple",
          account: { address: "0xabc...", derivationPath: null, derivationIndex: null, source: "imported" },
        }),
      keyringErrors.secretUnavailable().code,
    );

    keyring.loadFromPrivateKey(PK);
    const snap = keyring.toSnapshot();
    expect(() => keyring.hydrate(snap)).not.toThrow();

    const bad = {
      type: "simple" as const,
      account: {
        address: "0x0000000000000000000000000000000000000000",
        derivationPath: null,
        derivationIndex: null,
        source: "imported" as const,
      },
    };
    expectCode(() => keyring.hydrate(bad), keyringErrors.secretUnavailable().code);

    keyring.hydrate({ type: "simple", account: null });
    expect(keyring.getAccounts()).toHaveLength(0);
  });
});
