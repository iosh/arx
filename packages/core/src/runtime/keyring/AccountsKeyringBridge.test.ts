import { describe, expect, it, vi } from "vitest";
import type { KeyringAccount } from "../../keyring/types.js";
import { AccountsKeyringBridge } from "./AccountsKeyringBridge.js";
import type { KeyringService } from "./KeyringService.js";

const namespace = "eip155";
const chainRef = "eip155:1";

const createDerivedAccount = (address: string): KeyringAccount<string> => ({
  address,
  derivationIndex: 0,
  derivationPath: "m/44'/60'/0'/0/0",
  source: "derived",
});

const noopLogger = vi.fn();

describe("AccountsKeyringBridge", () => {
  it("does not switch active when switchActive=false", async () => {
    const account = createDerivedAccount("0xaaa");
    const keyring = {
      hasNamespace: vi.fn().mockReturnValue(true),
      deriveNextAccount: vi.fn().mockReturnValue(account),
      removeAccount: vi.fn(),
    } as unknown as KeyringService;

    const accounts = {
      addAccount: vi.fn().mockResolvedValue({ all: [account.address], primary: account.address }),
      removeAccount: vi.fn(),
      switchActive: vi.fn(),
      getState: vi.fn().mockReturnValue({
        namespaces: { [namespace]: { all: [account.address], primary: account.address } },
        active: null,
      }),
      getActivePointer: vi.fn().mockReturnValue(null),
    };

    const bridge = new AccountsKeyringBridge({ keyring, accounts, logger: noopLogger });
    await bridge.deriveAccount({ namespace, chainRef, switchActive: false });

    expect(accounts.switchActive).not.toHaveBeenCalled();
  });

  it("rolls back keyring when addAccount fails", async () => {
    const thrown = new Error("add failed");
    const account = createDerivedAccount("0xbbb");
    const keyring = {
      hasNamespace: vi.fn().mockReturnValue(true),
      deriveNextAccount: vi.fn().mockReturnValue(account),
      removeAccount: vi.fn(),
    } as unknown as KeyringService;

    const accounts = {
      addAccount: vi.fn().mockRejectedValue(thrown),
      removeAccount: vi.fn().mockResolvedValue({ all: [], primary: null }),
      switchActive: vi.fn(),
      getState: vi.fn().mockReturnValue({ namespaces: {}, active: null }),
      getActivePointer: vi.fn().mockReturnValue(null),
    };

    const bridge = new AccountsKeyringBridge({ keyring, accounts, logger: noopLogger });

    await expect(bridge.deriveAccount({ namespace, chainRef })).rejects.toBe(thrown);

    expect(accounts.removeAccount).not.toHaveBeenCalled();
    expect(keyring.removeAccount).toHaveBeenCalledWith(namespace, account.address);
  });

  it("restores controller state when keyring removal fails", async () => {
    const account = createDerivedAccount("0xccc");
    const keyring = {
      hasNamespace: vi.fn().mockReturnValue(true),
      removeAccount: vi.fn().mockImplementation(() => {
        throw new Error("keyring failure");
      }),
    } as unknown as KeyringService;

    const accounts = {
      addAccount: vi.fn().mockResolvedValue({ all: [account.address], primary: account.address }),
      removeAccount: vi.fn().mockResolvedValue({ all: [], primary: null }),
      switchActive: vi.fn(),
      getState: vi.fn().mockReturnValue({
        namespaces: { [namespace]: { all: [account.address], primary: account.address } },
        active: { namespace, chainRef, address: account.address },
      }),
      getActivePointer: vi.fn().mockReturnValue({ namespace, chainRef, address: account.address }),
    };

    const bridge = new AccountsKeyringBridge({ keyring, accounts, logger: noopLogger });

    await expect(bridge.removeAccount({ namespace, chainRef, address: account.address })).rejects.toThrow(
      "keyring failure",
    );

    expect(accounts.addAccount).toHaveBeenCalledWith({
      chainRef,
      address: account.address,
      makePrimary: true,
    });
    expect(accounts.switchActive).toHaveBeenCalledWith({ chainRef, address: account.address });
  });

  it("importAccount uses custom switchActive flag", async () => {
    const account = { ...createDerivedAccount("0xddd"), source: "imported" as const };
    const keyring = {
      hasNamespace: vi.fn().mockReturnValue(true),
      importAccount: vi.fn().mockReturnValue(account),
      removeAccount: vi.fn(),
      hasAccount: vi.fn().mockReturnValue(true),
    } as unknown as KeyringService;

    const accounts = {
      addAccount: vi.fn().mockResolvedValue({ all: [account.address], primary: null }),
      removeAccount: vi.fn().mockResolvedValue({ all: [], primary: null }),
      switchActive: vi.fn(),
      getState: vi.fn().mockReturnValue({ namespaces: {}, active: null }),
      getActivePointer: vi.fn().mockReturnValue(null),
    };

    const bridge = new AccountsKeyringBridge({ keyring, accounts, logger: noopLogger });
    await bridge.importAccount({ namespace, chainRef, privateKey: "0x01", switchActive: true });

    expect(accounts.switchActive).toHaveBeenCalledWith({ chainRef, address: account.address });
  });
});
