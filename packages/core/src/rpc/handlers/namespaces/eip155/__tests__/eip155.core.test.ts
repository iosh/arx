import type { JsonRpcParams } from "@metamask/utils";
import { describe, expect, it } from "vitest";
import type { ChainMetadata } from "../../../../../chains/metadata.js";
import {
  ApprovalTypes,
  PermissionScopes,
  type RequestPermissionsApprovalPayload,
} from "../../../../../controllers/index.js";
import {
  ADD_CHAIN_PARAMS,
  ADDED_CHAIN_REF,
  ALT_CHAIN,
  createExecutor,
  createServices,
  ORIGIN,
  setupApprovalResponder,
  setupSwitchChainApprovalResponder,
  TEST_MNEMONIC,
  waitForChainInNetwork,
} from "./eip155.test.helpers.js";

// TODO: add eth_requestAccounts rejection test once approval  -> account flow is implemented

describe("eip155 handlers - core error paths", () => {
  it("return 4902 for wallet_switchEthereumChain when the chain is unknown", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x9999" }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: 4902,
        message: "Requested chain is not registered with ARX",
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("switches chains and retains the active account when wallet_switchEthereumChain succeeds", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    await services.session.vault.initialize({ password: "test" });
    await services.session.unlock.unlock({ password: "test" });

    const execute = createExecutor(services);
    const mainnet = services.controllers.network.getActiveChain();

    await services.controllers.chainRegistry.upsertChain(ALT_CHAIN);
    await waitForChainInNetwork(services, ALT_CHAIN.chainRef);

    const teardownApprovalResponder = setupSwitchChainApprovalResponder(services);

    const { keyringId } = await services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

    const derived = await services.keyring.deriveAccount(keyringId);
    await services.controllers.accounts.switchActive({ chainRef: mainnet.chainRef, address: derived.address });
    const activeAddress = derived.address;

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: ALT_CHAIN.chainId }] as JsonRpcParams,
          },
        }),
      ).resolves.toBeNull();

      expect(services.controllers.network.getActiveChain().chainRef).toBe(ALT_CHAIN.chainRef);
      expect(services.controllers.accounts.getSelectedPointer({ chainRef: ALT_CHAIN.chainRef })).toMatchObject({
        chainRef: ALT_CHAIN.chainRef,
        address: activeAddress,
        namespace: "eip155",
      });
    } finally {
      teardownApprovalResponder();
      services.lifecycle.destroy();
    }
  });

  it("switches chains when only chainRef is provided", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    await services.controllers.chainRegistry.upsertChain(ALT_CHAIN);
    await waitForChainInNetwork(services, ALT_CHAIN.chainRef);

    const teardownApprovalResponder = setupSwitchChainApprovalResponder(services);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainRef: ALT_CHAIN.chainRef }] as JsonRpcParams,
          },
        }),
      ).resolves.toBeNull();

      expect(services.controllers.network.getActiveChain().chainRef).toBe(ALT_CHAIN.chainRef);
    } finally {
      teardownApprovalResponder();
      services.lifecycle.destroy();
    }
  });

  it("rejects when chainId and chainRef do not match", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    await services.controllers.chainRegistry.upsertChain(ALT_CHAIN);
    await waitForChainInNetwork(services, ALT_CHAIN.chainRef);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x1", chainRef: ALT_CHAIN.chainRef }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: -32602,
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("rejects invalid hex chainId values", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    try {
      // Test both forms: non-hex string and invalid hex characters
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "not-hex" }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: -32602 });

      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0xGG" }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: -32602 });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("returns 4902 when chain lacks wallet_switchEthereumChain feature", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const baseChain: ChainMetadata = {
      ...ALT_CHAIN,
      chainRef: "eip155:8453",
      chainId: "0x2105",
      displayName: "Base",
      features: ["eip155"],
    };
    await services.controllers.chainRegistry.upsertChain(baseChain);
    await waitForChainInNetwork(services, baseChain.chainRef);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x2105" }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: 4902,
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("rejects non-eip155 namespaces", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainRef: "conflux:cfx" }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: 4902,
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("rejects when no chain parameters are provided", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: -32602,
      });

      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{}] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: -32602,
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("emits activeChainChanged event on successful switch", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    await services.controllers.chainRegistry.upsertChain(ALT_CHAIN);
    await waitForChainInNetwork(services, ALT_CHAIN.chainRef);

    const teardownApprovalResponder = setupSwitchChainApprovalResponder(services);

    const changes: string[] = [];
    const unsubscribe = services.controllers.network.onActiveChainChanged(({ next }) => {
      changes.push(next);
    });

    try {
      await execute({
        origin: ORIGIN,
        request: {
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ALT_CHAIN.chainId }] as JsonRpcParams,
        },
      });

      expect(changes).toContain(ALT_CHAIN.chainRef);
    } finally {
      teardownApprovalResponder();
      unsubscribe();
      services.lifecycle.destroy();
    }
  });

  it("throw invalid params when eth_sendTransaction receives no payload", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_sendTransaction", params: [] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({
        code: -32602,
        message: "eth_sendTransaction requires at least one transaction parameter",
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("adds a new chain via wallet_addEthereumChain", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    const teardownApprovalResponder = setupApprovalResponder(services, async (task) => {
      if (task.type === ApprovalTypes.AddChain) {
        const payload = task.payload as { metadata: ChainMetadata; isUpdate: boolean };
        await services.controllers.chainRegistry.upsertChain(payload.metadata);
        await services.controllers.approvals.resolve(task.id, async () => null);
        return true;
      }
      return false;
    });

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_addEthereumChain",
            params: [ADD_CHAIN_PARAMS] as JsonRpcParams,
          },
        }),
      ).resolves.toBeNull();

      const networkChain = await waitForChainInNetwork(services, ADDED_CHAIN_REF);
      expect(networkChain.displayName).toBe("Base Mainnet");
      expect(networkChain.rpcEndpoints[0]?.url).toBe("https://mainnet.base.org");

      const registryEntry = services.controllers.chainRegistry.getChain(ADDED_CHAIN_REF);
      expect(registryEntry?.metadata.displayName).toBe("Base Mainnet");
    } finally {
      teardownApprovalResponder();
      services.lifecycle.destroy();
    }
  });

  it("returns invalid params when wallet_addEthereumChain payload is malformed", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x1",
                chainName: "Invalid",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: [],
              },
            ] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: -32602,
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("maps approval rejection to 4001 for wallet_addEthereumChain", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    const rejectionError = Object.assign(new Error("user denied"), { code: 4001 });
    const teardownApprovalResponder = setupApprovalResponder(services, (task) => {
      if (task.type === ApprovalTypes.AddChain) {
        services.controllers.approvals.reject(task.id, rejectionError);
        return true;
      }
      return false;
    });

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_addEthereumChain",
            params: [ADD_CHAIN_PARAMS] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: 4001,
      });
    } finally {
      teardownApprovalResponder();
      services.lifecycle.destroy();
    }
  });

  it("rejects invalid chainId format", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_addEthereumChain",
            params: [
              {
                ...ADD_CHAIN_PARAMS,
                chainId: "123",
              },
            ] as unknown as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: -32602 });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("rejects invalid rpcUrls", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_addEthereumChain",
            params: [
              {
                ...ADD_CHAIN_PARAMS,
                rpcUrls: ["ftp://invalid.com"],
              },
            ] as unknown as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: -32602 });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("updates existing chain when re-adding", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    const teardownApprovalResponder = setupApprovalResponder(services, async (task) => {
      if (task.type === ApprovalTypes.AddChain) {
        const payload = task.payload as { metadata: ChainMetadata; isUpdate: boolean };
        await services.controllers.chainRegistry.upsertChain(payload.metadata);
        await services.controllers.approvals.resolve(task.id, async () => null);
        return true;
      }
      return false;
    });

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_addEthereumChain",
            params: [ADD_CHAIN_PARAMS] as unknown as JsonRpcParams,
          },
        }),
      ).resolves.toBeNull();
      await waitForChainInNetwork(services, ADDED_CHAIN_REF);

      const updatedParams = {
        ...ADD_CHAIN_PARAMS,
        rpcUrls: ["https://new-rpc.example"],
      };

      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_addEthereumChain",
            params: [updatedParams] as unknown as JsonRpcParams,
          },
        }),
      ).resolves.toBeNull();

      const networkChain = await waitForChainInNetwork(services, ADDED_CHAIN_REF);
      expect(networkChain.rpcEndpoints[0]?.url).toBe("https://new-rpc.example");

      const registryEntry = services.controllers.chainRegistry.getChain(ADDED_CHAIN_REF);
      expect(registryEntry?.metadata.rpcEndpoints[0]?.url).toBe("https://new-rpc.example");
    } finally {
      teardownApprovalResponder();
      services.lifecycle.destroy();
    }
  });

  it("rejects negative decimals", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_addEthereumChain",
            params: [
              {
                ...ADD_CHAIN_PARAMS,
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: -1 },
              },
            ] as unknown as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: -32602 });
    } finally {
      services.lifecycle.destroy();
    }
  });
  it("returns empty array for wallet_getPermissions when origin lacks grants", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    try {
      const result = await execute({
        origin: ORIGIN,
        request: { method: "wallet_getPermissions", params: [] as JsonRpcParams },
      });

      expect(result).toEqual([]);
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("returns EIP-2255 descriptors for wallet_getPermissions", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const chain = services.controllers.network.getActiveChain();
    await services.controllers.permissions.grant(ORIGIN, PermissionScopes.Basic, { chainRef: chain.chainRef });
    await services.controllers.permissions.setPermittedAccounts(ORIGIN, {
      chainRef: chain.chainRef,
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    const execute = createExecutor(services);
    try {
      const result = await execute({
        origin: ORIGIN,
        request: { method: "wallet_getPermissions", params: [] as JsonRpcParams },
      });

      expect(result).toEqual([
        {
          invoker: ORIGIN,
          parentCapability: "wallet_basic",
          caveats: [{ type: "arx:permittedChains", value: [chain.chainRef] }],
        },
        {
          invoker: ORIGIN,
          parentCapability: "eth_accounts",
          caveats: [
            { type: "arx:permittedChains", value: [chain.chainRef] },
            { type: "restrictReturnedAccounts", value: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] },
          ],
        },
      ]);
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("does not leak scope chains across different grants", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const main = services.controllers.network.getActiveChain();
    await services.controllers.chainRegistry.upsertChain(ALT_CHAIN);
    await waitForChainInNetwork(services, ALT_CHAIN.chainRef);

    await services.controllers.permissions.grant(ORIGIN, PermissionScopes.Basic, { chainRef: main.chainRef });
    await services.controllers.permissions.grant(ORIGIN, PermissionScopes.Basic, { chainRef: ALT_CHAIN.chainRef });
    await services.controllers.permissions.grant(ORIGIN, PermissionScopes.Sign, { chainRef: ALT_CHAIN.chainRef });

    const execute = createExecutor(services);
    try {
      const result = await execute({
        origin: ORIGIN,
        request: { method: "wallet_getPermissions", params: [] as JsonRpcParams },
      });

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            parentCapability: "wallet_basic",
            caveats: [{ type: "arx:permittedChains", value: [main.chainRef, ALT_CHAIN.chainRef] }],
          }),
          expect.objectContaining({
            parentCapability: "wallet_sign",
            caveats: [{ type: "arx:permittedChains", value: [ALT_CHAIN.chainRef] }],
          }),
        ]),
      );
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("grants permissions after wallet_requestPermissions approval", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const chain = services.controllers.network.getActiveChain();
    await services.session.vault.initialize({ password: "test" });
    await services.session.unlock.unlock({ password: "test" });
    await services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

    const accountsController = services.controllers.accounts as unknown as { refresh?: () => Promise<void> };
    await accountsController.refresh?.();

    const teardown = setupApprovalResponder(services, async (task) => {
      if (task.type !== ApprovalTypes.RequestPermissions) return false;
      const payload = task.payload as RequestPermissionsApprovalPayload;
      expect(payload.requested).toEqual(
        expect.arrayContaining([
          { capability: "wallet_basic", chains: [chain.chainRef], scope: PermissionScopes.Basic },
          { capability: "eth_accounts", chains: [chain.chainRef], scope: PermissionScopes.Accounts },
        ]),
      );
      await services.controllers.approvals.resolve(task.id, async () => ({
        granted: payload.requested,
      }));
      return true;
    });

    const execute = createExecutor(services);
    try {
      const result = await execute({
        origin: ORIGIN,
        request: { method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] as JsonRpcParams },
      });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ parentCapability: "wallet_basic" }),
          expect.objectContaining({ parentCapability: "eth_accounts" }),
        ]),
      );

      const state = services.controllers.permissions.getPermissions(ORIGIN);
      expect(state?.eip155?.scopes).toEqual(
        expect.arrayContaining([PermissionScopes.Basic, PermissionScopes.Accounts]),
      );
    } finally {
      teardown();
      services.lifecycle.destroy();
    }
  });

  it("returns [] for eth_accounts when wallet is unlocked but origin is not connected", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    await services.session.vault.initialize({ password: "test" });
    await services.session.unlock.unlock({ password: "test" });

    const execute = createExecutor(services);
    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_accounts", params: [] as JsonRpcParams },
        }),
      ).resolves.toEqual([]);
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("returns permitted accounts for eth_accounts after connection writes accountsByChain", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    await services.session.vault.initialize({ password: "test" });
    await services.session.unlock.unlock({ password: "test" });

    const chain = services.controllers.network.getActiveChain();
    const a1 = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
    const a2 = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";

    await services.controllers.permissions.setPermittedAccounts(ORIGIN, {
      namespace: "eip155",
      chainRef: chain.chainRef,
      accounts: [a1, a2],
    });

    const execute = createExecutor(services);
    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_accounts", params: [] as JsonRpcParams },
        }),
      ).resolves.toEqual([a1, a2]);

      await expect(
        execute({
          origin: "https://other.example",
          request: { method: "eth_accounts", params: [] as JsonRpcParams },
        }),
      ).resolves.toEqual([]);
    } finally {
      services.lifecycle.destroy();
    }
  });
});
