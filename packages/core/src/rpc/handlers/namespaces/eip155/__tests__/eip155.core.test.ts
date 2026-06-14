import type { JsonRpcParams } from "@metamask/utils";
import { describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../../../../../accounts/addressing/accountKey.js";
import { ApprovalKinds } from "../../../../../approvals/index.js";
import type { ChainMetadata } from "../../../../../chains/metadata.js";
import type { RequestPermissionsApprovalPayload } from "../../../../../permissions/service/types.js";
import {
  MemoryChainDefinitionsPort,
  MemoryChainRpcDefaultEndpointsPort,
} from "../../../../../runtime/__fixtures__/backgroundTestSetup.js";
import {
  ADD_CHAIN_PARAMS,
  ADDED_CHAIN_REF,
  ALT_CHAIN,
  connectOrigin,
  createExecutor,
  createRuntime,
  getActiveChainMetadata,
  ORIGIN,
  setupApprovalResponder,
  setupSwitchChainApprovalResponder,
  TEST_MNEMONIC,
  waitForChainInNetwork,
} from "./eip155.test.helpers.js";

describe("eip155 handlers - core error paths", () => {
  it("returns chain.not_found for wallet_switchEthereumChain when the chain is unknown", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
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
        code: "chain.not_found",
      });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("switches the provider chain without changing the wallet-selected chain", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    const execute = createExecutor(runtime);
    const mainnet = getActiveChainMetadata(runtime);

    await waitForChainInNetwork(runtime, ALT_CHAIN.chainRef);

    const teardownApprovalResponder = setupSwitchChainApprovalResponder(runtime);

    const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });

    const derived = await runtime.services.keyring.deriveAccount(keyringId);
    await runtime.services.accounts.setActiveAccount({
      namespace: mainnet.namespace,
      chainRef: mainnet.chainRef,
      accountKey: toAccountKeyFromAddress({
        chainRef: mainnet.chainRef,
        address: derived.address,
        accountCodecs: runtime.services.accountCodecs,
      }),
    });
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

      expect(runtime.services.chainViews.getSelectedChainView().chainRef).toBe(mainnet.chainRef);
      expect(runtime.services.walletChainSelection.getSelectedChainRef("eip155")).toBe(mainnet.chainRef);
      expect(
        runtime.services.providerChainSelection.getSelectedChainRef({
          origin: ORIGIN,
          namespace: "eip155",
        }),
      ).toBe(ALT_CHAIN.chainRef);
      expect(
        runtime.services.accounts.getActiveAccountForNamespace({
          namespace: mainnet.namespace,
          chainRef: mainnet.chainRef,
        }),
      ).toMatchObject({
        chainRef: mainnet.chainRef,
        canonicalAddress: activeAddress,
        namespace: "eip155",
      });
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects chainRef-only payloads", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainRef: ALT_CHAIN.chainRef }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({
        code: "global.rpc.invalid_params",
      });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects payloads that include internal chainRef fields", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

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
        code: "global.rpc.invalid_params",
      });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects invalid hex chainId values", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

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
      ).rejects.toMatchObject({ code: "global.rpc.invalid_params" });

      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0xGG" }] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: "global.rpc.invalid_params" });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects chainRef-shaped payloads from other namespaces", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

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
        code: "global.rpc.invalid_params",
      });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects when no chain parameters are provided", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

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
        code: "global.rpc.invalid_params",
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
        code: "global.rpc.invalid_params",
      });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("resolves provider requests from the origin-scoped provider chain selection", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    const mainnet = getActiveChainMetadata(runtime);
    await waitForChainInNetwork(runtime, ALT_CHAIN.chainRef);
    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });
    await connectOrigin({
      runtime,
      chainRefs: [mainnet.chainRef],
      addresses: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    const teardownApprovalResponder = setupSwitchChainApprovalResponder(runtime);
    const otherOrigin = "https://other.example";

    try {
      await execute({
        origin: ORIGIN,
        request: {
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ALT_CHAIN.chainId }] as JsonRpcParams,
        },
      });

      expect(runtime.services.chainViews.getSelectedChainView().chainRef).toBe(mainnet.chainRef);
      expect(runtime.services.walletChainSelection.getSelectedChainRef("eip155")).toBe(mainnet.chainRef);
      expect(
        runtime.services.providerChainSelection.getSelectedChainRef({
          origin: ORIGIN,
          namespace: "eip155",
        }),
      ).toBe(ALT_CHAIN.chainRef);
      expect(
        runtime.services.providerChainSelection.getSelectedChainRef({
          origin: otherOrigin,
          namespace: "eip155",
        }),
      ).toBeNull();

      const switchedChainResponse = await runtime.providerAccess.executeRpcRequest({
        id: "rpc-chain-switched",
        jsonrpc: "2.0",
        method: "eth_chainId",
        context: { namespace: "eip155" },
        execution: {
          requestScope: {
            transport: "provider",
            origin: ORIGIN,
            portId: "provider-port",
            sessionId: "provider-session",
          },
        },
      });
      expect(switchedChainResponse).toMatchObject({ result: ALT_CHAIN.chainId });

      const switchedAccountsResponse = await runtime.providerAccess.executeRpcRequest({
        id: "rpc-accounts-switched",
        jsonrpc: "2.0",
        method: "eth_accounts",
        context: { namespace: "eip155" },
        execution: {
          requestScope: {
            transport: "provider",
            origin: ORIGIN,
            portId: "provider-port",
            sessionId: "provider-session",
          },
        },
      });
      expect(switchedAccountsResponse).toMatchObject({ result: [] });

      const fallbackChainResponse = await runtime.providerAccess.executeRpcRequest({
        id: "rpc-chain-fallback",
        jsonrpc: "2.0",
        method: "eth_chainId",
        context: { namespace: "eip155" },
        execution: {
          requestScope: {
            transport: "provider",
            origin: otherOrigin,
            portId: "provider-port-other",
            sessionId: "provider-session-other",
          },
        },
      });
      expect(fallbackChainResponse).toMatchObject({ result: mainnet.chainId });
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.shutdown();
    }
  });

  it("throw invalid params when eth_sendTransaction receives no payload", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_sendTransaction", params: [] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({
        code: "global.rpc.invalid_params",
      });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("adds a new chain via wallet_addEthereumChain", async () => {
    const chainDefinitionsPort = new MemoryChainDefinitionsPort();
    const chainRpcDefaultEndpointsPort = new MemoryChainRpcDefaultEndpointsPort();
    const runtime = createRuntime({
      store: {
        ports: {
          chainDefinitions: chainDefinitionsPort,
        },
      },
      chainRpcDefaultEndpoints: { port: chainRpcDefaultEndpointsPort },
    });
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.kind === ApprovalKinds.AddChain) {
        await runtime.services.approvals.resolve({ approvalId: task.approvalId, action: "approve" });
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

      const networkChain = await waitForChainInNetwork(runtime, ADDED_CHAIN_REF);
      expect(networkChain.displayName).toBe("Base Mainnet");
      expect(networkChain.rpcEndpoints[0]?.url).toBe("https://mainnet.base.org");

      const registryEntry = runtime.services.supportedChains.getChain(ADDED_CHAIN_REF);
      expect(registryEntry?.metadata.displayName).toBe("Base Mainnet");
      await expect(chainDefinitionsPort.get(ADDED_CHAIN_REF)).resolves.toMatchObject({
        chainRef: ADDED_CHAIN_REF,
        source: "custom",
        createdByOrigin: ORIGIN,
        metadata: {
          chainRef: ADDED_CHAIN_REF,
          displayName: "Base Mainnet",
        },
      });

      await expect(chainRpcDefaultEndpointsPort.get(ADDED_CHAIN_REF)).resolves.toMatchObject({
        chainRef: ADDED_CHAIN_REF,
        rpcEndpoints: [{ url: "https://mainnet.base.org", type: "public" }],
      });
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.shutdown();
    }
  });

  it("returns invalid params when wallet_addEthereumChain payload is malformed", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

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
        code: "global.rpc.invalid_params",
      });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("maps approval rejection to an owner-local approval error for wallet_addEthereumChain", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

    const teardownApprovalResponder = setupApprovalResponder(runtime, (task) => {
      if (task.kind === ApprovalKinds.AddChain) {
        void runtime.services.approvals.resolve({
          approvalId: task.approvalId,
          action: "reject",
          reason: "user denied",
        });
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
        code: "approval.rejected",
      });
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects invalid chainId format", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

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
      ).rejects.toMatchObject({ code: "global.rpc.invalid_params" });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects invalid rpcUrls", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

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
      ).rejects.toMatchObject({ code: "global.rpc.invalid_params" });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("updates existing chain when re-adding", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.kind === ApprovalKinds.AddChain) {
        await runtime.services.approvals.resolve({ approvalId: task.approvalId, action: "approve" });
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
      await waitForChainInNetwork(runtime, ADDED_CHAIN_REF);

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

      const networkChain = await waitForChainInNetwork(runtime, ADDED_CHAIN_REF);
      expect(networkChain.rpcEndpoints[0]?.url).toBe("https://new-rpc.example");

      const registryEntry = runtime.services.supportedChains.getChain(ADDED_CHAIN_REF);
      expect(registryEntry?.metadata.rpcEndpoints[0]?.url).toBe("https://new-rpc.example");
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.shutdown();
    }
  });

  it("treats semantically equivalent builtin wallet_addEthereumChain requests as a no-op", async () => {
    const mainnet: ChainMetadata = {
      chainRef: "eip155:1",
      namespace: "eip155",
      chainId: "0x1",
      displayName: "Ethereum",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcEndpoints: [{ url: "https://rpc.ethereum.example", type: "public" }],
    };

    const existing: ChainMetadata = {
      chainRef: ADDED_CHAIN_REF,
      namespace: "eip155",
      chainId: "0X2105",
      displayName: "Base Mainnet",
      shortName: "base",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcEndpoints: [
        {
          url: "https://secondary.base.org/",
          type: "authenticated",
          headers: { Authorization: "Bearer token" },
        },
        { url: "https://mainnet.base.org", type: "public" },
      ],
      blockExplorers: [
        { type: "secondary", url: "https://basescan.org/", title: "BaseScan" },
        { type: "default", url: "https://www.base.org" },
      ],
      icon: { url: "https://assets.example.com/base.svg", format: "svg" },
    };

    const runtime = createRuntime({
      supportedChains: {
        seed: [mainnet, ALT_CHAIN as ChainMetadata, existing],
      },
    });
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    let approvalRequested = false;
    const unsubscribeApproval = runtime.services.approvals.onCreated(() => {
      approvalRequested = true;
    });

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_addEthereumChain",
            params: [
              {
                ...ADD_CHAIN_PARAMS,
                rpcUrls: ["https://mainnet.base.org/", "https://secondary.base.org"],
                blockExplorerUrls: ["https://www.base.org/", "https://basescan.org"],
              },
            ] as unknown as JsonRpcParams,
          },
        }),
      ).resolves.toBeNull();

      expect(approvalRequested).toBe(false);
      expect(runtime.services.supportedChains.getChain(ADDED_CHAIN_REF)).toMatchObject({
        source: "builtin",
        metadata: {
          chainRef: existing.chainRef,
          displayName: existing.displayName,
        },
      });
    } finally {
      unsubscribeApproval();
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects builtin wallet_addEthereumChain conflicts before approval", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    let approvalRequested = false;
    const unsubscribeApproval = runtime.services.approvals.onCreated(() => {
      approvalRequested = true;
    });

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "wallet_addEthereumChain",
            params: [
              {
                ...ADD_CHAIN_PARAMS,
                chainId: "0x1",
                chainName: "Ethereum",
                rpcUrls: ["https://malicious.example"],
              },
            ] as unknown as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: "chain.not_supported" });

      expect(approvalRequested).toBe(false);
    } finally {
      unsubscribeApproval();
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects negative decimals", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

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
      ).rejects.toMatchObject({ code: "global.rpc.invalid_params" });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });
  it("returns empty array for wallet_getPermissions when origin lacks grants", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    try {
      const result = await execute({
        origin: ORIGIN,
        request: { method: "wallet_getPermissions", params: [] as JsonRpcParams },
      });

      expect(result).toEqual([]);
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("returns EIP-2255 descriptors for wallet_getPermissions", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await connectOrigin({
      runtime,
      chainRefs: [chain.chainRef],
      addresses: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    const execute = createExecutor(runtime);
    try {
      const result = await execute({
        origin: ORIGIN,
        request: { method: "wallet_getPermissions", params: [] as JsonRpcParams },
      });

      expect(result).toEqual([
        {
          invoker: ORIGIN,
          parentCapability: "eth_accounts",
          caveats: [{ type: "restrictReturnedAccounts", value: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }],
        },
      ]);
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("wallet_getPermissions and eth_accounts do not leak account access across permitted chains", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const main = getActiveChainMetadata(runtime);
    await waitForChainInNetwork(runtime, ALT_CHAIN.chainRef);

    await connectOrigin({
      runtime,
      chainRefs: [main.chainRef, ALT_CHAIN.chainRef],
      addresses: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    const execute = createExecutor(runtime);
    try {
      const result = await execute({
        origin: ORIGIN,
        request: { method: "wallet_getPermissions", params: [] as JsonRpcParams },
      });

      expect(result).toEqual([
        {
          invoker: ORIGIN,
          parentCapability: "eth_accounts",
          caveats: [{ type: "restrictReturnedAccounts", value: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }],
        },
      ]);

      await runtime.services.walletChainSelection.selectChain(ALT_CHAIN.chainRef);

      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "wallet_getPermissions", params: [] as JsonRpcParams },
        }),
      ).resolves.toEqual([]);

      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_accounts", params: [] as JsonRpcParams },
        }),
      ).resolves.toEqual([]);
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("persists connection authorization after wallet_requestPermissions approval", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });
    const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
    const account = await runtime.services.keyring.deriveAccount(keyringId);

    const accountSelectionService = runtime.services.accounts as unknown as { refresh?: () => Promise<void> };
    await accountSelectionService.refresh?.();
    const accountKey = toAccountKeyFromAddress({
      chainRef: chain.chainRef,
      address: account.address,
      accountCodecs: runtime.services.accountCodecs,
    });
    await runtime.services.accounts.setActiveAccount({
      namespace: chain.namespace,
      chainRef: chain.chainRef,
      accountKey,
    });

    const teardown = setupApprovalResponder(runtime, async (task) => {
      if (task.kind !== ApprovalKinds.RequestPermissions) return false;
      const payload = task.request as RequestPermissionsApprovalPayload;
      expect(payload.chainRef).toBe(chain.chainRef);
      expect(payload.requestedGrants).toEqual([{ grantKind: "eth_accounts", chainRefs: [chain.chainRef] }]);
      await runtime.services.approvals.resolve({
        approvalId: task.approvalId,
        action: "approve",
        decision: { accountKeys: [accountKey] },
      });
      return true;
    });

    const execute = createExecutor(runtime);
    try {
      const result = await execute({
        origin: ORIGIN,
        request: { method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] as JsonRpcParams },
      });

      expect(result).toEqual([
        expect.objectContaining({
          parentCapability: "eth_accounts",
        }),
      ]);

      const authorization = runtime.services.permissions.getAuthorization(ORIGIN, { namespace: "eip155" });
      expect(Object.keys(authorization?.chains ?? {})).toEqual([chain.chainRef]);
      expect(authorization?.chains[chain.chainRef]?.accountKeys).toEqual([accountKey]);
    } finally {
      teardown();
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects unsupported capabilities in wallet_requestPermissions", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "wallet_requestPermissions", params: [{ wallet_basic: {} }] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({ code: "global.rpc.invalid_params" });
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects unselectable accounts during wallet_requestPermissions approval", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });
    const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
    await runtime.services.keyring.deriveAccount(keyringId);

    const accountSelectionService = runtime.services.accounts as unknown as { refresh?: () => Promise<void> };
    await accountSelectionService.refresh?.();

    const teardown = setupApprovalResponder(runtime, async (task) => {
      if (task.kind !== ApprovalKinds.RequestPermissions) return false;
      void runtime.services.approvals
        .resolve({
          approvalId: task.approvalId,
          action: "approve",
          decision: { accountKeys: ["eip155:ffffffffffffffffffffffffffffffffffffffff"] },
        })
        .catch(() => {});
      return true;
    });

    const execute = createExecutor(runtime);
    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({ code: "global.permission.denied" });

      const authorization = runtime.services.permissions.getAuthorization(ORIGIN, { namespace: chain.namespace });
      expect(authorization).toBeNull();
    } finally {
      teardown();
      runtime.lifecycle.shutdown();
    }
  });

  it("replaces targeted chain authorization on repeated eth_requestAccounts approval", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });
    const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
    const first = await runtime.services.keyring.deriveAccount(keyringId);
    const second = await runtime.services.keyring.deriveAccount(keyringId);

    const accountSelectionService = runtime.services.accounts as unknown as { refresh?: () => Promise<void> };
    await accountSelectionService.refresh?.();

    const firstAccountId = toAccountKeyFromAddress({
      chainRef: chain.chainRef,
      address: first.address,
      accountCodecs: runtime.services.accountCodecs,
    });
    const secondAccountId = toAccountKeyFromAddress({
      chainRef: chain.chainRef,
      address: second.address,
      accountCodecs: runtime.services.accountCodecs,
    });

    await runtime.services.accounts.setActiveAccount({
      namespace: chain.namespace,
      chainRef: chain.chainRef,
      accountKey: firstAccountId,
    });
    await connectOrigin({
      runtime,
      chainRefs: [chain.chainRef],
      addresses: [first.address, second.address],
    });

    const teardown = setupApprovalResponder(runtime, async (task) => {
      if (task.kind !== ApprovalKinds.RequestAccounts) return false;
      await runtime.services.approvals.resolve({
        approvalId: task.approvalId,
        action: "approve",
        decision: { accountKeys: [secondAccountId] },
      });
      return true;
    });

    const execute = createExecutor(runtime);
    try {
      await execute({
        origin: ORIGIN,
        request: { method: "eth_requestAccounts", params: [] as JsonRpcParams },
      });

      const authorization = runtime.services.permissions.getAuthorization(ORIGIN, { namespace: "eip155" });
      expect(authorization?.chains[chain.chainRef]?.accountKeys).toEqual([secondAccountId]);
    } finally {
      teardown();
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects unselectable accounts during eth_requestAccounts approval", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });
    const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
    await runtime.services.keyring.deriveAccount(keyringId);

    const accountSelectionService = runtime.services.accounts as unknown as { refresh?: () => Promise<void> };
    await accountSelectionService.refresh?.();

    const teardown = setupApprovalResponder(runtime, async (task) => {
      if (task.kind !== ApprovalKinds.RequestAccounts) return false;
      void runtime.services.approvals
        .resolve({
          approvalId: task.approvalId,
          action: "approve",
          decision: { accountKeys: ["eip155:ffffffffffffffffffffffffffffffffffffffff"] },
        })
        .catch(() => {});
      return true;
    });

    const execute = createExecutor(runtime);
    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_requestAccounts", params: [] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({ code: "global.permission.denied" });

      const authorization = runtime.services.permissions.getAuthorization(ORIGIN, { namespace: chain.namespace });
      expect(authorization).toBeNull();
    } finally {
      teardown();
      runtime.lifecycle.shutdown();
    }
  });

  it("returns [] for eth_accounts when wallet is unlocked but origin is not connected", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    const execute = createExecutor(runtime);
    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "eth_accounts", params: [] as JsonRpcParams },
        }),
      ).resolves.toEqual([]);
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("returns permitted accounts for eth_accounts after connection persists authorization", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    const chain = getActiveChainMetadata(runtime);
    const a1 = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
    const a2 = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";

    await connectOrigin({
      runtime,
      chainRefs: [chain.chainRef],
      addresses: [a1, a2],
    });

    const execute = createExecutor(runtime);
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
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects personal_sign when the requested account is not permitted for the origin", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await connectOrigin({
      runtime,
      chainRefs: [chain.chainRef],
      addresses: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    const execute = createExecutor(runtime);
    const requestApprovalSpy = vi.spyOn(runtime.services.approvals, "create");
    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "personal_sign",
            params: ["0xdeadbeef", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: "global.permission.denied" });
      expect(requestApprovalSpy).not.toHaveBeenCalled();
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects eth_signTypedData_v4 when the requested account is not permitted for the origin", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await connectOrigin({
      runtime,
      chainRefs: [chain.chainRef],
      addresses: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    const execute = createExecutor(runtime);
    const requestApprovalSpy = vi.spyOn(runtime.services.approvals, "create");
    const typedData = {
      domain: { name: "ARX", version: "1" },
      message: { contents: "hello" },
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
            params: ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", JSON.stringify(typedData)] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: "global.permission.denied" });
      expect(requestApprovalSpy).not.toHaveBeenCalled();
    } finally {
      runtime.lifecycle.shutdown();
    }
  });

  it("rejects eth_sendTransaction when the from address is not permitted for the origin", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await connectOrigin({
      runtime,
      chainRefs: [chain.chainRef],
      addresses: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    const execute = createExecutor(runtime);
    const txSpy = vi.spyOn(runtime.transactions, "requestTransactionApproval");
    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "eth_sendTransaction",
            params: [
              {
                from: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                to: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                value: "0x0",
                data: "0x",
              },
            ] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: "global.permission.denied" });
      expect(txSpy).not.toHaveBeenCalled();
    } finally {
      runtime.lifecycle.shutdown();
    }
  });
});
