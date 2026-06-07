import { describe, expect, it } from "vitest";
import type { KeyringAccount, SimpleKeyringSnapshot } from "../types.js";
import { EvmPrivateKeyKeyring } from "./EvmPrivateKeyKeyring.js";

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

describe("EvmPrivateKeyKeyring", () => {
  it("imports and exposes account", () => {
    const keyring = new EvmPrivateKeyKeyring();
    keyring.loadFromPrivateKey(PK);

    const accounts = keyring.getAccounts();
    expect(accounts).toHaveLength(1);
    const [account] = accounts;
    if (!account) throw new Error("Expected an imported account");
    expect(keyring.hasAccount(account.address)).toBe(true);
    const exported = keyring.exportPrivateKey(account.address);
    expect(exported).toBeInstanceOf(Uint8Array);
  });

  it("replaces secret when importing again", () => {
    const keyring = new EvmPrivateKeyKeyring();
    keyring.loadFromPrivateKey(PK);
    const firstAccount = keyring.getAccounts()[0];
    if (!firstAccount) throw new Error("Expected an imported account");
    const first = firstAccount.address;

    keyring.loadFromPrivateKey(PK2); // should overwrite
    const [account] = keyring.getAccounts();

    if (!account) throw new Error("Expected an imported account");
    expect(account.address).not.toBe(first);
    expect(() => keyring.exportPrivateKey(account.address)).not.toThrow();
  });

  it("remove clears account", () => {
    const keyring = new EvmPrivateKeyKeyring();
    keyring.loadFromPrivateKey(PK);
    const [account] = keyring.getAccounts();
    if (!account) throw new Error("Expected an imported account");
    keyring.removeAccount(account.address);
    expect(keyring.getAccounts()).toHaveLength(0);
    expectCode(() => keyring.removeAccount(account.address), "keyring.account_not_found");
  });

  it("hydrates only when secret is loaded and addresses match", () => {
    const keyring = new EvmPrivateKeyKeyring();
    const snapshot: SimpleKeyringSnapshot<KeyringAccount<string>> = {
      type: "simple",
      account: {
        address: "0xabc0000000000000000000000000000000000000",
        derivationPath: null,
        derivationIndex: null,
        source: "imported",
      },
    };
    expectCode(() => keyring.hydrate(snapshot), "keyring.secret_unavailable");

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
    expectCode(() => keyring.hydrate(badSnapshot), "keyring.secret_unavailable");

    keyring.hydrate({ type: "simple", account: null });
    expect(keyring.getAccounts()).toHaveLength(0);
  });

  it("hydrates with loaded secret and rejects mismatches", () => {
    const keyring = new EvmPrivateKeyKeyring();

    expectCode(
      () =>
        keyring.hydrate({
          type: "simple",
          account: { address: "0xabc...", derivationPath: null, derivationIndex: null, source: "imported" },
        }),
      "keyring.secret_unavailable",
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
    expectCode(() => keyring.hydrate(bad), "keyring.secret_unavailable");

    keyring.hydrate({ type: "simple", account: null });
    expect(keyring.getAccounts()).toHaveLength(0);
  });
});
