import type { JsonRpcParams } from "@metamask/utils";
import { describe, expect, it, vi } from "vitest";
import type { ChainMetadata } from "../../../chains/metadata.js";
import { ApprovalTypes, PermissionScopes } from "../../../controllers/index.js";
import { createBackgroundServices } from "../../../runtime/createBackgroundServices.js";
import { TransactionAdapterRegistry } from "../../../transactions/adapters/registry.js";
import { createMethodExecutor, type RpcClient } from "../../index.js";

const ORIGIN = "https://dapp.example";

const ALT_CHAIN = {
  chainRef: "eip155:10",
  namespace: "eip155",
  chainId: "0xa",
  displayName: "Optimism",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcEndpoints: [{ url: "https://rpc.optimism.example", type: "public" as const }],
  features: ["eip155", "wallet_switchEthereumChain"],
};

const ADD_CHAIN_PARAMS = {
  chainId: "0x2105",
  chainName: "Base Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};
const ADDED_CHAIN_REF = "eip155:8453";
const TEST_MNEMONIC = "test test test test test test test test test test test junk";

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const createChainRegistryPort = () => ({
  async get() {
    return null;
  },
  async getAll() {
    return [];
  },
  async put() {},
  async putMany() {},
  async delete() {},
  async clear() {},
});
const createServices = (overrides?: Parameters<typeof createBackgroundServices>[0]) => {
  const { chainRegistry, ...rest } = overrides ?? {};
  return createBackgroundServices({
    chainRegistry: {
      port: createChainRegistryPort(),
      ...(chainRegistry ?? {}),
    },
    ...rest,
  });
};
const createExecutor = (services: ReturnType<typeof createServices>) =>
  createMethodExecutor(services.controllers, { rpcClientRegistry: services.rpcClients });
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

    await services.controllers.network.addChain(ALT_CHAIN);

    const { keyringId } = await services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

    const { account } = await services.accountsRuntime.deriveAccount({
      namespace: "eip155",
      chainRef: mainnet.chainRef,
      keyringId,
      makePrimary: true,
      switchActive: true,
    });
    const activeAddress = account.address;

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
      expect(services.controllers.accounts.getActivePointer()).toMatchObject({
        chainRef: ALT_CHAIN.chainRef,
        address: activeAddress,
        namespace: "eip155",
      });
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("switches chains when only caip2 is provided", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    await services.controllers.network.addChain(ALT_CHAIN);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ caip2: ALT_CHAIN.chainRef }] as JsonRpcParams,
          },
        }),
      ).resolves.toBeNull();

      expect(services.controllers.network.getActiveChain().chainRef).toBe(ALT_CHAIN.chainRef);
    } finally {
      services.lifecycle.destroy();
    }
  });

  it("rejects when chainId and caip2 do not match", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    await services.controllers.network.addChain(ALT_CHAIN);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x1", caip2: ALT_CHAIN.chainRef }] as JsonRpcParams,
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
    await services.controllers.network.addChain({
      ...ALT_CHAIN,
      chainRef: "eip155:8453",
      chainId: "0x2105",
      displayName: "Base",
      features: ["eip155"],
    });

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
            params: [{ caip2: "conflux:cfx" }] as JsonRpcParams,
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

  it("emits chainChanged event on successful switch", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    await services.controllers.network.addChain(ALT_CHAIN);

    const changes: string[] = [];
    const unsubscribe = services.controllers.network.onChainChanged((chain) => {
      changes.push(chain.chainRef);
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

    const originalRequestApproval = services.controllers.approvals.requestApproval.bind(services.controllers.approvals);
    services.controllers.approvals.requestApproval = (async (task) => {
      // Add the chain when approval is requested
      if (task.type === ApprovalTypes.AddChain) {
        const payload = task.payload as { metadata: ChainMetadata; isUpdate: boolean };
        await services.controllers.chainRegistry.upsertChain(payload.metadata);
      }
      return null;
    }) as typeof services.controllers.approvals.requestApproval;

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

      await flushAsync();

      const registryEntry = services.controllers.chainRegistry.getChain(ADDED_CHAIN_REF);
      expect(registryEntry?.metadata.displayName).toBe("Base Mainnet");

      const networkChain = services.controllers.network.getChain(ADDED_CHAIN_REF);
      expect(networkChain?.displayName).toBe("Base Mainnet");
      expect(networkChain?.rpcEndpoints[0]?.url).toBe("https://mainnet.base.org");
    } finally {
      services.controllers.approvals.requestApproval = originalRequestApproval;
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

    const originalRequestApproval = services.controllers.approvals.requestApproval.bind(services.controllers.approvals);
    services.controllers.approvals.requestApproval = (async () => {
      throw new Error("user denied");
    }) as typeof services.controllers.approvals.requestApproval;

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
      services.controllers.approvals.requestApproval = originalRequestApproval;
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

    const originalRequestApproval = services.controllers.approvals.requestApproval.bind(services.controllers.approvals);
    services.controllers.approvals.requestApproval = (async (task) => {
      // Add/update the chain when approval is requested
      if (task.type === ApprovalTypes.AddChain) {
        const payload = task.payload as { metadata: ChainMetadata; isUpdate: boolean };
        await services.controllers.chainRegistry.upsertChain(payload.metadata);
      }
      return null;
    }) as typeof services.controllers.approvals.requestApproval;

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
      await flushAsync();

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
      await flushAsync();

      const registryEntry = services.controllers.chainRegistry.getChain(ADDED_CHAIN_REF);
      expect(registryEntry?.metadata.rpcEndpoints[0]?.url).toBe("https://new-rpc.example");

      const networkChain = services.controllers.network.getChain(ADDED_CHAIN_REF);
      expect(networkChain?.rpcEndpoints[0]?.url).toBe("https://new-rpc.example");
    } finally {
      services.controllers.approvals.requestApproval = originalRequestApproval;
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
});

describe("eip155 handlers - approval metadata", () => {
  it("includes namespace metadata for eth_requestAccounts approvals", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const activeChain = services.controllers.network.getActiveChain();

    let capturedTask: Parameters<typeof services.controllers.approvals.requestApproval>[0] | undefined;
    const originalRequestApproval = services.controllers.approvals.requestApproval;
    services.controllers.approvals.requestApproval = (async (task) => {
      capturedTask = task;
      // Return empty array directly instead of calling original method
      // This test only needs to verify the approval task metadata, not actually approve
      return [];
    }) as typeof services.controllers.approvals.requestApproval;

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_requestAccounts", params: [] as JsonRpcParams },
        }),
      ).resolves.toEqual([]);

      expect(capturedTask?.namespace).toBe("eip155");
      expect(capturedTask?.chainRef).toBe(activeChain.chainRef);
    } finally {
      services.controllers.approvals.requestApproval = originalRequestApproval;
      services.lifecycle.destroy();
    }
  });

  it("includes namespace metadata for personal_sign approvals", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const activeChain = services.controllers.network.getActiveChain();

    let capturedTask: Parameters<typeof services.controllers.approvals.requestApproval>[0] | undefined;
    const originalRequestApproval = services.controllers.approvals.requestApproval;
    services.controllers.approvals.requestApproval = (async (task) => {
      capturedTask = task;
      // Reject with 4100 (unauthorized) since keyring is not unlocked
      // This test only needs to verify the approval task metadata
      throw Object.assign(new Error("The requested method and/or account has not been authorized by the user."), {
        code: 4100,
      });
    }) as typeof services.controllers.approvals.requestApproval;
    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "personal_sign",
            params: ["0xdeadbeef", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: 4100 });

      expect(capturedTask?.namespace).toBe("eip155");
      expect(capturedTask?.chainRef).toBe(activeChain.chainRef);
    } finally {
      services.controllers.approvals.requestApproval = originalRequestApproval;
      services.lifecycle.destroy();
    }
  });

  it("includes namespace metadata for eth_signTypedData_v4 approvals", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const activeChain = services.controllers.network.getActiveChain();

    let capturedTask: Parameters<typeof services.controllers.approvals.requestApproval>[0] | undefined;
    const originalRequestApproval = services.controllers.approvals.requestApproval;
    services.controllers.approvals.requestApproval = (async (task) => {
      capturedTask = task;
      // Reject with 4100 (unauthorized) since keyring is not unlocked
      // This test only needs to verify the approval task metadata
      throw Object.assign(new Error("The requested method and/or account has not been authorized by the user."), {
        code: 4100,
      });
    }) as typeof services.controllers.approvals.requestApproval;

    const typedData = {
      domain: { name: "ARX", version: "1" },
      message: { contents: "Hello" },
      primaryType: "Example",
      types: {
        EIP712Domain: [{ name: "name", type: "string" }],
        Example: [{ name: "contents", type: "string" }],
      },
    };

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "eth_signTypedData_v4",
            params: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", JSON.stringify(typedData)] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: 4100 });

      expect(capturedTask?.namespace).toBe("eip155");
      expect(capturedTask?.chainRef).toBe(activeChain.chainRef);
    } finally {
      services.controllers.approvals.requestApproval = originalRequestApproval;
      services.lifecycle.destroy();
    }
  });

  it("includes chain metadata for wallet_addEthereumChain approvals", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    let capturedTask: Parameters<typeof services.controllers.approvals.requestApproval>[0] | undefined;
    const originalRequestApproval = services.controllers.approvals.requestApproval;
    services.controllers.approvals.requestApproval = (async (task) => {
      capturedTask = task;
      // Return null directly to approve adding the chain
      // This test only needs to verify the approval task metadata
      return null;
    }) as typeof services.controllers.approvals.requestApproval;

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS] as JsonRpcParams },
        }),
      ).resolves.toBeNull();

      expect(capturedTask?.namespace).toBe("eip155");
      expect(capturedTask?.chainRef).toBe(ADDED_CHAIN_REF);
    } finally {
      services.controllers.approvals.requestApproval = originalRequestApproval;
      services.lifecycle.destroy();
    }
  });

  it("includes namespace metadata for eth_sendTransaction approvals", async () => {
    const registry = new TransactionAdapterRegistry();
    registry.register("eip155", {
      buildDraft: vi.fn(async () => ({
        prepared: {},
        summary: {},
        warnings: [],
        issues: [],
      })),
      signTransaction: vi.fn(async () => ({ raw: "0x", hash: null })),
      broadcastTransaction: vi.fn(async () => ({ hash: "0x1111" })),
    });
    const services = createServices({
      transactions: { registry },
    });
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const activeChain = services.controllers.network.getActiveChain();

    let capturedTask: Parameters<typeof services.controllers.approvals.requestApproval>[0] | undefined;
    const originalRequestApproval = services.controllers.approvals.requestApproval;
    services.controllers.approvals.requestApproval = (async (task) => {
      capturedTask = task;
      // Reject with 4001 (user rejected)
      // This test only needs to verify the approval task metadata
      throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    }) as typeof services.controllers.approvals.requestApproval;

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "eth_sendTransaction",
            params: [
              {
                from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                value: "0x0",
                data: "0x",
              },
            ] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: 4001 });

      expect(capturedTask?.namespace).toBe("eip155");
      expect(capturedTask?.chainRef).toBe(activeChain.chainRef);
    } finally {
      services.controllers.approvals.requestApproval = originalRequestApproval;
      services.lifecycle.destroy();
    }
  });

  it("returns a submission summary when eth_sendTransaction auto-approves", async () => {
    const rpcMocks = {
      estimateGas: vi.fn(async () => "0x5208"),
      getTransactionCount: vi.fn(async () => "0x1"),
      getFeeData: vi.fn(async () => ({
        maxFeePerGas: "0x59682f00",
        maxPriorityFeePerGas: "0x3b9aca00",
      })),
      sendRawTransaction: vi.fn(async () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      getTransactionReceipt: vi.fn(async () => null),
    };
    const rpcFactory = vi.fn(() => ({
      request: vi.fn(),
      estimateGas: rpcMocks.estimateGas,
      getTransactionCount: rpcMocks.getTransactionCount,
      getFeeData: rpcMocks.getFeeData,
      sendRawTransaction: rpcMocks.sendRawTransaction,
      getTransactionReceipt: rpcMocks.getTransactionReceipt,
    }));

    const services = createServices({
      transactions: { registry: new TransactionAdapterRegistry() },
      rpcClients: {
        factories: [{ namespace: "eip155", factory: rpcFactory }],
      },
    });

    await services.lifecycle.initialize();
    services.lifecycle.start();

    await services.session.vault.initialize({ password: "test" });
    await services.session.unlock.unlock({ password: "test" });

    // Setup auto-approval for transactions
    const unsubscribe = services.controllers.approvals.onRequest(async (task) => {
      try {
        if (task.type === "wallet_sendTransaction") {
          const result = await services.controllers.transactions.approveTransaction(task.id);
          await services.controllers.approvals.resolve(task.id, async () => result);
        }
      } catch (error) {
        // Ignore errors if approval was already resolved
      }
    });

    try {
      const execute = createExecutor(services);
      const mainnet = services.controllers.network.getActiveChain();

      const { keyringId } = await services.keyring.confirmNewMnemonic(TEST_MNEMONIC);
      const { account } = await services.accountsRuntime.deriveAccount({
        namespace: "eip155",
        chainRef: mainnet.chainRef,
        keyringId,
        makePrimary: true,
        switchActive: true,
      });

      // Grant basic scope only; transaction scope should be added after a successful send.
      await services.controllers.permissions.grant(ORIGIN, PermissionScopes.Basic, {
        namespace: "eip155",
        chainRef: mainnet.chainRef,
      });

      const beforePermissions = services.controllers.permissions.getState();
      const beforeNamespace = beforePermissions.origins[ORIGIN]?.eip155;
      expect(beforeNamespace?.scopes ?? []).not.toContain(PermissionScopes.Transaction);

      const txHash = (await execute({
        origin: ORIGIN,
        request: {
          method: "eth_sendTransaction",
          params: [
            {
              from: account.address,
              to: account.address,
              value: "0x0",
              data: "0x",
            },
          ] as JsonRpcParams,
        },
      })) as string;

      expect(txHash).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

      const { history } = services.controllers.transactions.getState();
      expect(history).toHaveLength(1);

      const stored = history[0]!;
      expect(stored.id).toEqual(expect.any(String));
      expect(stored.status).toBe("broadcast");
      expect(stored.hash).toBe(txHash);
      expect(stored.namespace).toBe("eip155");
      expect(stored.caip2).toBe(mainnet.chainRef);
      expect(stored.from).toBe(account.address);
      expect(stored.warnings).toEqual([expect.objectContaining({ code: "transaction.draft.chain_id_missing" })]);
      expect(stored.issues).toEqual([]);
      expect(rpcMocks.sendRawTransaction).toHaveBeenCalledTimes(1);

      const afterPermissions = services.controllers.permissions.getState();
      const afterNamespace = afterPermissions.origins[ORIGIN]?.eip155;
      expect(afterNamespace?.scopes ?? []).toContain(PermissionScopes.Transaction);
      expect(afterNamespace?.chains ?? []).toContain(mainnet.chainRef);
    } finally {
      unsubscribe();
      services.lifecycle.destroy();
    }
  });

  it("signs personal_sign requests when the account is unlocked", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    await services.session.vault.initialize({ password: "test" });
    await services.session.unlock.unlock({ password: "test" });

    const approvalSpy = vi.spyOn(services.controllers.approvals, "requestApproval").mockImplementation(async (task) => {
      // Simulate UI auto-approving and calling the actual signing
      const payload = task.payload as { from: string; message: string };
      return await services.controllers.signers.eip155.signPersonalMessage({
        address: payload.from,
        message: payload.message,
      });
    });

    try {
      const mainnet = services.controllers.network.getActiveChain();
      const { keyringId } = await services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

      const { account } = await services.accountsRuntime.deriveAccount({
        namespace: "eip155",
        chainRef: mainnet.chainRef,
        keyringId,
        makePrimary: true,
        switchActive: true,
      });

      const execute = createExecutor(services);
      const message = "0xdeadbeef";

      const signature = (await execute({
        origin: ORIGIN,
        request: {
          method: "personal_sign",
          params: [message, account.address] as JsonRpcParams,
        },
      })) as string;

      expect(signature).toMatch(/^0x[0-9a-f]+$/i);
      expect(signature.length).toBe(132); // 65 bytes hex
      await expect(
        services.controllers.signers.eip155.signPersonalMessage({ address: account.address, message }),
      ).resolves.toBe(signature);
    } finally {
      approvalSpy.mockRestore();
      services.lifecycle.destroy();
    }
  });

  it("signs eth_signTypedData_v4 requests with the eip155 signer", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    await services.session.vault.initialize({ password: "test" });
    await services.session.unlock.unlock({ password: "test" });

    const approvalSpy = vi.spyOn(services.controllers.approvals, "requestApproval").mockImplementation(async (task) => {
      // Simulate UI auto-approving and calling the actual signing
      const payload = task.payload as { from: string; typedData: string };
      return await services.controllers.signers.eip155.signTypedData({
        address: payload.from,
        typedData: payload.typedData,
      });
    });

    try {
      const mainnet = services.controllers.network.getActiveChain();
      const { keyringId } = await services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

      const { account } = await services.accountsRuntime.deriveAccount({
        namespace: "eip155",
        chainRef: mainnet.chainRef,
        keyringId,
        makePrimary: true,
        switchActive: true,
      });

      // Ensure Sign scope is not present before the first typed data signature.
      const beforeState = services.controllers.permissions.getState();
      const beforeNamespace = beforeState.origins[ORIGIN]?.eip155;
      expect(beforeNamespace?.scopes ?? []).not.toContain(PermissionScopes.Sign);

      const execute = createExecutor(services);
      const payload = {
        domain: { name: "ARX", version: "1" },
        message: { contents: "hello" },
        primaryType: "Example",
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
          ],
          Example: [{ name: "contents", type: "string" }],
        },
      };
      const typedData = JSON.stringify(payload);

      const signature = (await execute({
        origin: ORIGIN,
        request: {
          method: "eth_signTypedData_v4",
          params: [account.address, typedData] as JsonRpcParams,
        },
      })) as string;

      expect(signature).toMatch(/^0x[0-9a-f]+$/i);
      expect(signature.length).toBe(132);
      await expect(
        services.controllers.signers.eip155.signTypedData({ address: account.address, typedData }),
      ).resolves.toBe(signature);

      const afterState = services.controllers.permissions.getState();
      const afterNamespace = afterState.origins[ORIGIN]?.eip155;
      expect(afterNamespace?.scopes ?? []).toContain(PermissionScopes.Sign);
      expect(afterNamespace?.chains ?? []).toContain(mainnet.chainRef);
    } finally {
      approvalSpy.mockRestore();
      services.lifecycle.destroy();
    }
  });
});

describe("eip155 passthrough executor", () => {
  it("forwards allowed passthrough methods to the RPC client", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const params = ["0xabc", "latest"] as JsonRpcParams;
    const chainRef = services.controllers.network.getActiveChain().chainRef;
    const rpcClient: Pick<RpcClient, "request"> = {
      request: vi.fn().mockResolvedValue("0x64"),
    };
    const getClient = vi.spyOn(services.rpcClients, "getClient").mockReturnValue(rpcClient as RpcClient);

    try {
      const result = await execute({
        origin: ORIGIN,
        request: { method: "eth_getBalance", params },
      });

      expect(result).toBe("0x64");
      expect(getClient).toHaveBeenCalledWith("eip155", chainRef);
      expect(rpcClient.request).toHaveBeenCalledWith({ method: "eth_getBalance", params });
    } finally {
      getClient.mockRestore();
      services.lifecycle.destroy();
    }
  });

  it("rejects methods outside the passthrough matrix", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const getClient = vi.spyOn(services.rpcClients, "getClient");

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_getWork", params: [] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({ code: -32601 });

      expect(getClient).not.toHaveBeenCalled();
    } finally {
      getClient.mockRestore();
      services.lifecycle.destroy();
    }
  });

  it("propagates RPC errors returned by the node", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const rpcClient: Pick<RpcClient, "request"> = {
      request: vi.fn().mockRejectedValue({ code: -32000, message: "execution reverted" }),
    };
    const getClient = vi.spyOn(services.rpcClients, "getClient").mockReturnValue(rpcClient as RpcClient);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_getBalance", params: [] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({ code: -32000, message: "execution reverted" });
    } finally {
      getClient.mockRestore();
      services.lifecycle.destroy();
    }
  });

  it("wraps unexpected client failures as internal errors", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const chainRef = services.controllers.network.getActiveChain().chainRef;
    const rpcClient: Pick<RpcClient, "request"> = {
      request: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const getClient = vi.spyOn(services.rpcClients, "getClient").mockReturnValue(rpcClient as RpcClient);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_getBalance", params: [] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({
        code: -32603,
        message: 'Failed to execute "eth_getBalance"',
        data: { namespace: "eip155", chainRef },
      });
    } finally {
      getClient.mockRestore();
      services.lifecycle.destroy();
    }
  });
});
