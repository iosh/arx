import { describe, expect, it, vi } from "vitest";
import { toCanonicalEvmAddress } from "../../chains/address.js";
import { StoreAccountsController } from "../../controllers/account/StoreAccountsController.js";
import type { AccountMessengerTopics } from "../../controllers/account/types.js";
import { EthereumHdKeyring, PrivateKeyKeyring } from "../../keyring/index.js";
import type { KeyringAccount } from "../../keyring/types.js";
import { ControllerMessenger } from "../../messenger/ControllerMessenger.js";
import { createAccountsService } from "../../services/accounts/AccountsService.js";
import { createKeyringMetasService } from "../../services/keyringMetas/KeyringMetasService.js";
import type { SettingsPort } from "../../services/settings/port.js";
import { createSettingsService } from "../../services/settings/SettingsService.js";
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

  it("does not attempt to rollback keyring when switchActive fails", async () => {
    const thrown = new Error("switchActive failed");
    const account = createDerivedAccount("0xbbb");
    const keyring = {
      hasNamespace: vi.fn().mockReturnValue(true),
      getKeyrings: () => [{ id: "hd1", type: "hd", namespace }],
      deriveAccount: vi.fn().mockResolvedValue(account),
      removeAccount: vi.fn().mockResolvedValue(undefined),
    } as unknown as KeyringService;

    const accounts = {
      switchActive: vi.fn().mockRejectedValue(thrown),
      getState: vi.fn().mockReturnValue({ namespaces: {}, active: null }),
      getActivePointer: vi.fn().mockReturnValue(null),
    };

    const bridge = new AccountsKeyringBridge({ keyring, accounts, logger: noopLogger });

    await expect(bridge.deriveAccount({ namespace, chainRef, keyringId: "hd1", switchActive: true })).rejects.toBe(
      thrown,
    );

    expect(keyring.removeAccount).not.toHaveBeenCalled();
  });

  it("propagates keyring removal failure", async () => {
    const account = createDerivedAccount("0xccc");
    const keyring = {
      hasNamespace: vi.fn().mockReturnValue(true),
      removeAccount: vi.fn().mockImplementation(() => {
        throw new Error("keyring failure");
      }),
    } as unknown as KeyringService;

    const accounts = {
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

    expect(accounts.switchActive).not.toHaveBeenCalled();
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
    const accountsStore = createAccountsService({ port: new MemoryAccountsPort() });
    const keyringMetas = createKeyringMetasService({ port: new MemoryKeyringMetasPort() });

    let rawSettings: any = null;
    const settingsPort: SettingsPort = {
      async get() {
        return rawSettings;
      },
      async put(next) {
        rawSettings = next;
      },
    };
    const settings = createSettingsService({
      port: settingsPort,
      now: () => 1,
    });

    const network = {
      getActiveChain: () => ({ chainRef, namespace }) as any,
      onChainChanged: () => () => {},
    };
    const accountsController = new StoreAccountsController({
      messenger,
      accounts: accountsStore,
      settings,
      network,
    });

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

    await accountsController.refresh();
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

    await accountsController.refresh();
    const stateAfterImport = accountsController.getState();
    expect(stateAfterImport.namespaces[namespace]?.all).toContain(imported.address);
    expect(stateAfterImport.active?.address).toBe(imported.address);
    expect(keyringService.hasAccount(namespace, imported.address)).toBe(true);

    await bridge.removeAccount({ namespace, chainRef, address: imported.address });
    await accountsController.refresh();
    const stateAfterRemove = accountsController.getState();
    expect(stateAfterRemove.namespaces[namespace]?.all).not.toContain(imported.address);
    expect(stateAfterRemove.active?.address).toBe(firstAddress);
    expect(keyringService.hasAccount(namespace, imported.address)).toBe(false);
    expect(keyringService.getAccounts().map((a) => `0x${a.payloadHex}`)).not.toContain(imported.address);
  });
});
