import { describe, expect, it, vi } from "vitest";
import { toCanonicalEvmAddress } from "../../chains/address.js";
import { InMemoryMultiNamespaceAccountsController } from "../../controllers/account/MultiNamespaceAccountsController.js";
import type { AccountMessengerTopics } from "../../controllers/account/types.js";
import { EthereumHdKeyring, PrivateKeyKeyring } from "../../keyring/index.js";
import type { KeyringAccount } from "../../keyring/types.js";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { createAccountsService } from "../../services/accounts/AccountsService.js";
import { createKeyringMetasService } from "../../services/keyringMetas/KeyringMetasService.js";
import { MemoryAccountsPort, MemoryKeyringMetasPort } from "../__fixtures__/backgroundTestSetup.js";
import { AccountsKeyringBridge } from "./AccountsKeyringBridge.js";
import { KeyringService } from "./KeyringService.js";

const namespace = "eip155";
const chainRef = "eip155:1";
const MNEMONIC = "test test test test test test test test test test test junk";
const PRIVATE_KEY = "0xc83c5a4a2353021a9bf912a7cf8f053fde951355514868f3e75e085cad7490a1";

const encoder = new TextEncoder();

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
      getKeyrings: () => [{ id: "hd1", type: "hd", namespace }],
      deriveAccount: vi.fn().mockResolvedValue(account),
      removeAccount: vi.fn().mockResolvedValue(undefined),
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
    await bridge.deriveAccount({ namespace, chainRef, keyringId: "hd1", switchActive: false });

    expect(accounts.switchActive).not.toHaveBeenCalled();
  });

  it("rolls back keyring when addAccount fails", async () => {
    const thrown = new Error("add failed");
    const account = createDerivedAccount("0xbbb");
    const keyring = {
      hasNamespace: vi.fn().mockReturnValue(true),
      getKeyrings: () => [{ id: "hd1", type: "hd", namespace }],
      deriveAccount: vi.fn().mockResolvedValue(account),
      removeAccount: vi.fn().mockResolvedValue(undefined),
    } as unknown as KeyringService;

    const accounts = {
      addAccount: vi.fn().mockRejectedValue(thrown),
      removeAccount: vi.fn().mockResolvedValue({ all: [], primary: null }),
      switchActive: vi.fn(),
      getState: vi.fn().mockReturnValue({ namespaces: {}, active: null }),
      getActivePointer: vi.fn().mockReturnValue(null),
    };

    const bridge = new AccountsKeyringBridge({ keyring, accounts, logger: noopLogger });

    await expect(bridge.deriveAccount({ namespace, chainRef, keyringId: "hd1" })).rejects.toBe(thrown);

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
      getKeyrings: () => [],
      importPrivateKey: vi.fn().mockResolvedValue({ keyringId: "pk1", account }),
      hasAccount: vi.fn().mockReturnValue(true),
      removeAccount: vi.fn(),
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

  it("syncs derived and imported accounts with live keyring service", async () => {
    const messenger = new ControllerMessenger<AccountMessengerTopics<string>>({});
    const accountsController = new InMemoryMultiNamespaceAccountsController({
      messenger,
    });

    const accountsStore = createAccountsService({ port: new MemoryAccountsPort() });
    const keyringMetas = createKeyringMetasService({ port: new MemoryKeyringMetasPort() });

    const vault = {
      exportKey: () => encoder.encode(JSON.stringify({ keyrings: [] })),
      isUnlocked: () => true,
      verifyPassword: () => Promise.resolve(),
    };
    const unlock = {
      isUnlocked: () => true,
      onUnlocked: () => () => {},
      onLocked: () => () => {},
    };
    const keyringService = new KeyringService({
      vault,
      unlock,
      accountsStore,
      keyringMetas,
      namespaces: [
        {
          namespace,
          toCanonicalAddress: toCanonicalEvmAddress,
          factories: { hd: () => new EthereumHdKeyring(), "private-key": () => new PrivateKeyKeyring() },
        },
      ],
    });

    await keyringService.attach();

    const { keyringId, address: firstAddress } = await keyringService.confirmNewMnemonic(MNEMONIC);
    await accountsController.addAccount({ chainRef, address: firstAddress, makePrimary: true });
    await accountsController.switchActive({ chainRef, address: firstAddress });

    const bridge = new AccountsKeyringBridge({
      keyring: keyringService,
      accounts: accountsController,
      logger: noopLogger,
    });

    const { account: derived } = await bridge.deriveAccount({
      namespace,
      chainRef,
      keyringId,
      makePrimary: true,
      switchActive: true,
    });

    const stateAfterDerive = accountsController.getState();
    expect(stateAfterDerive.namespaces[namespace]?.all).toContain(derived.address);
    expect(stateAfterDerive.active?.address).toBe(derived.address);
    expect(keyringService.getAccounts().map((a) => `0x${a.payloadHex}`)).toContain(derived.address);

    const { account: imported } = await bridge.importAccount({
      namespace,
      chainRef,
      privateKey: PRIVATE_KEY,
      switchActive: true,
    });

    const stateAfterImport = accountsController.getState();
    expect(stateAfterImport.namespaces[namespace]?.all).toContain(imported.address);
    expect(stateAfterImport.active?.address).toBe(imported.address);
    expect(keyringService.hasAccount(namespace, imported.address)).toBe(true);

    await bridge.removeAccount({ namespace, chainRef, address: imported.address });
    const stateAfterRemove = accountsController.getState();
    expect(stateAfterRemove.namespaces[namespace]?.all).not.toContain(imported.address);
    expect(stateAfterRemove.active?.address).toBe(derived.address);
    expect(keyringService.hasAccount(namespace, imported.address)).toBe(false);
    expect(keyringService.getAccounts().map((a) => `0x${a.payloadHex}`)).not.toContain(imported.address);
  });
});
