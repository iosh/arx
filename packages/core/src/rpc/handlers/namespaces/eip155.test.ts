import type { JsonRpcParams } from "@metamask/utils";
import { describe, expect, it, vi } from "vitest";
import { createBackgroundServices } from "../../../runtime/createBackgroundServices.js";
import { createMethodExecutor } from "../../index.js";

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

const createServices = () =>
  createBackgroundServices({
    chainRegistry: {
      port: {
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
      },
    },
  });
// TODO: add eth_requestAccounts rejection test once approval  -> account flow is implemented

describe("eip155 handlers - core error paths", () => {
  it("return 4902 for wallet_switchEthereumChain when the chain is unknown", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createMethodExecutor(services.controllers);
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

    const execute = createMethodExecutor(services.controllers);
    const mainnet = services.controllers.network.getActiveChain();

    await services.controllers.network.addChain(ALT_CHAIN);

    services.keyring.setNamespaceFromMnemonic("eip155", { mnemonic: TEST_MNEMONIC });

    const { account } = await services.accountsRuntime.deriveAccount({
      namespace: "eip155",
      chainRef: mainnet.chainRef,
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

    const execute = createMethodExecutor(services.controllers);
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

    const execute = createMethodExecutor(services.controllers);
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

    const execute = createMethodExecutor(services.controllers);

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

    const execute = createMethodExecutor(services.controllers);
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

    const execute = createMethodExecutor(services.controllers);

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

    const execute = createMethodExecutor(services.controllers);

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

    const execute = createMethodExecutor(services.controllers);
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

    const execute = createMethodExecutor(services.controllers);

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

    const execute = createMethodExecutor(services.controllers);

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
      services.lifecycle.destroy();
    }
  });

  it("returns invalid params when wallet_addEthereumChain payload is malformed", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createMethodExecutor(services.controllers);

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

    const execute = createMethodExecutor(services.controllers);

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

    const execute = createMethodExecutor(services.controllers);

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

    const execute = createMethodExecutor(services.controllers);

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

    const execute = createMethodExecutor(services.controllers);

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
      services.lifecycle.destroy();
    }
  });

  it("rejects negative decimals", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createMethodExecutor(services.controllers);

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

    const execute = createMethodExecutor(services.controllers);
    const activeChain = services.controllers.network.getActiveChain();

    let capturedTask: Parameters<typeof services.controllers.approvals.requestApproval>[0] | undefined;
    const originalRequestApproval = services.controllers.approvals.requestApproval;
    services.controllers.approvals.requestApproval = (async (task, strategy) => {
      capturedTask = task;
      return originalRequestApproval.call(
        services.controllers.approvals,
        task as Parameters<typeof originalRequestApproval>[0],
        strategy as Parameters<typeof originalRequestApproval>[1],
      );
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

    const execute = createMethodExecutor(services.controllers);
    const activeChain = services.controllers.network.getActiveChain();

    let capturedTask: Parameters<typeof services.controllers.approvals.requestApproval>[0] | undefined;
    const originalRequestApproval = services.controllers.approvals.requestApproval;
    services.controllers.approvals.requestApproval = (async (task, strategy) => {
      capturedTask = task;
      return originalRequestApproval.call(
        services.controllers.approvals,
        task as Parameters<typeof originalRequestApproval>[0],
        strategy as Parameters<typeof originalRequestApproval>[1],
      );
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

    const execute = createMethodExecutor(services.controllers);
    const activeChain = services.controllers.network.getActiveChain();

    let capturedTask: Parameters<typeof services.controllers.approvals.requestApproval>[0] | undefined;
    const originalRequestApproval = services.controllers.approvals.requestApproval;
    services.controllers.approvals.requestApproval = (async (task, strategy) => {
      capturedTask = task;
      return originalRequestApproval.call(
        services.controllers.approvals,
        task as Parameters<typeof originalRequestApproval>[0],
        strategy as Parameters<typeof originalRequestApproval>[1],
      );
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

    const execute = createMethodExecutor(services.controllers);

    let capturedTask: Parameters<typeof services.controllers.approvals.requestApproval>[0] | undefined;
    const originalRequestApproval = services.controllers.approvals.requestApproval;
    services.controllers.approvals.requestApproval = (async (task, strategy) => {
      capturedTask = task;
      return originalRequestApproval.call(
        services.controllers.approvals,
        task as Parameters<typeof originalRequestApproval>[0],
        strategy as Parameters<typeof originalRequestApproval>[1],
      );
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
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createMethodExecutor(services.controllers);
    const activeChain = services.controllers.network.getActiveChain();

    let capturedTask: Parameters<typeof services.controllers.approvals.requestApproval>[0] | undefined;
    const originalRequestApproval = services.controllers.approvals.requestApproval;
    services.controllers.approvals.requestApproval = (async (task, strategy) => {
      capturedTask = task;
      return originalRequestApproval.call(
        services.controllers.approvals,
        task as Parameters<typeof originalRequestApproval>[0],
        strategy as Parameters<typeof originalRequestApproval>[1],
      );
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

  it("signs personal_sign requests when the account is unlocked", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const approvalSpy = vi
      .spyOn(services.controllers.approvals, "requestApproval")
      .mockImplementation(async (task, strategy) => {
        if (!strategy) {
          throw new Error("strategy is required for signing tests");
        }
        return strategy(task);
      });

    try {
      const mainnet = services.controllers.network.getActiveChain();
      services.keyring.setNamespaceFromMnemonic("eip155", { mnemonic: TEST_MNEMONIC });

      const { account } = await services.accountsRuntime.deriveAccount({
        namespace: "eip155",
        chainRef: mainnet.chainRef,
        makePrimary: true,
        switchActive: true,
      });

      const execute = createMethodExecutor(services.controllers);
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

    const approvalSpy = vi
      .spyOn(services.controllers.approvals, "requestApproval")
      .mockImplementation(async (task, strategy) => {
        if (!strategy) {
          throw new Error("strategy is required for signing tests");
        }
        return strategy(task);
      });

    try {
      const mainnet = services.controllers.network.getActiveChain();
      services.keyring.setNamespaceFromMnemonic("eip155", { mnemonic: TEST_MNEMONIC });

      const { account } = await services.accountsRuntime.deriveAccount({
        namespace: "eip155",
        chainRef: mainnet.chainRef,
        makePrimary: true,
        switchActive: true,
      });

      const execute = createMethodExecutor(services.controllers);
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
    } finally {
      approvalSpy.mockRestore();
      services.lifecycle.destroy();
    }
  });
});
