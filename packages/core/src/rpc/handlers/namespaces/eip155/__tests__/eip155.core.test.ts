import type { JsonRpcParams } from "@metamask/utils";
import { describe, expect, it, vi } from "vitest";
import { toAccountIdFromAddress } from "../../../../../accounts/addressing/accountId.js";
import type { ChainMetadata } from "../../../../../chains/metadata.js";
import {
  ApprovalKinds,
  PermissionCapabilities,
  type RequestPermissionsApprovalPayload,
} from "../../../../../controllers/index.js";
import {
  ADD_CHAIN_PARAMS,
  ADDED_CHAIN_REF,
  ALT_CHAIN,
  createExecutor,
  createRuntime,
  getActiveChainMetadata,
  ORIGIN,
  setupApprovalResponder,
  setupSwitchChainApprovalResponder,
  TEST_MNEMONIC,
  waitForChainInNetwork,
} from "./eip155.test.helpers.js";

// TODO: add eth_requestAccounts rejection test once approval  -> account flow is implemented

describe("eip155 handlers - core error paths", () => {
  it("return 4902 for wallet_switchEthereumChain when the chain is unknown", async () => {
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
        code: 4902,
        message: "Requested chain is not registered with ARX",
      });
    } finally {
      runtime.lifecycle.destroy();
    }
  });

  it("switches chains and retains the active account when wallet_switchEthereumChain succeeds", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.vault.initialize({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    const execute = createExecutor(runtime);
    const mainnet = getActiveChainMetadata(runtime);

    await waitForChainInNetwork(runtime, ALT_CHAIN.chainRef);

    const teardownApprovalResponder = setupSwitchChainApprovalResponder(runtime);

    const { keyringId } = await runtime.services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

    const derived = await runtime.services.keyring.deriveAccount(keyringId);
    await runtime.controllers.accounts.setActiveAccount({
      namespace: mainnet.namespace,
      chainRef: mainnet.chainRef,
      accountId: toAccountIdFromAddress({ chainRef: mainnet.chainRef, address: derived.address }),
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

      expect(runtime.controllers.network.getState().activeChainRef).toBe(ALT_CHAIN.chainRef);
      expect(
        runtime.controllers.accounts.getActiveAccountForNamespace({
          namespace: ALT_CHAIN.namespace,
          chainRef: ALT_CHAIN.chainRef,
        }),
      ).toMatchObject({
        chainRef: ALT_CHAIN.chainRef,
        canonicalAddress: activeAddress,
        namespace: "eip155",
      });
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.destroy();
    }
  });

  it("switches chains when only chainRef is provided", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    await waitForChainInNetwork(runtime, ALT_CHAIN.chainRef);

    const teardownApprovalResponder = setupSwitchChainApprovalResponder(runtime);

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

      expect(runtime.controllers.network.getState().activeChainRef).toBe(ALT_CHAIN.chainRef);
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.destroy();
    }
  });

  it("rejects when chainId and chainRef do not match", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    await waitForChainInNetwork(runtime, ALT_CHAIN.chainRef);

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
      runtime.lifecycle.destroy();
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
      runtime.lifecycle.destroy();
    }
  });

  it("rejects non-eip155 namespaces", async () => {
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
        code: 4902,
      });
    } finally {
      runtime.lifecycle.destroy();
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
      runtime.lifecycle.destroy();
    }
  });

  it("emits activeChainChanged event on successful switch", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    await waitForChainInNetwork(runtime, ALT_CHAIN.chainRef);

    const teardownApprovalResponder = setupSwitchChainApprovalResponder(runtime);

    const changes: string[] = [];
    const unsubscribe = runtime.controllers.network.onActiveChainChanged(({ next }) => {
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
      runtime.lifecycle.destroy();
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
        code: -32602,
        message: "eth_sendTransaction requires at least one transaction parameter",
      });
    } finally {
      runtime.lifecycle.destroy();
    }
  });

  it("adds a new chain via wallet_addEthereumChain", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.kind === ApprovalKinds.AddChain) {
        await runtime.controllers.approvals.resolve({ id: task.id, action: "approve" });
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

      const registryEntry = runtime.controllers.chainDefinitions.getChain(ADDED_CHAIN_REF);
      expect(registryEntry?.metadata.displayName).toBe("Base Mainnet");
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.destroy();
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
        code: -32602,
      });
    } finally {
      runtime.lifecycle.destroy();
    }
  });

  it("maps approval rejection to 4001 for wallet_addEthereumChain", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

    const rejectionError = Object.assign(new Error("user denied"), { code: 4001 });
    const teardownApprovalResponder = setupApprovalResponder(runtime, (task) => {
      if (task.kind === ApprovalKinds.AddChain) {
        void runtime.controllers.approvals.resolve({ id: task.id, action: "reject", error: rejectionError });
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
      runtime.lifecycle.destroy();
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
      ).rejects.toMatchObject({ code: -32602 });
    } finally {
      runtime.lifecycle.destroy();
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
      ).rejects.toMatchObject({ code: -32602 });
    } finally {
      runtime.lifecycle.destroy();
    }
  });

  it("updates existing chain when re-adding", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.kind === ApprovalKinds.AddChain) {
        await runtime.controllers.approvals.resolve({ id: task.id, action: "approve" });
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

      const registryEntry = runtime.controllers.chainDefinitions.getChain(ADDED_CHAIN_REF);
      expect(registryEntry?.metadata.rpcEndpoints[0]?.url).toBe("https://new-rpc.example");
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.destroy();
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
      description: "User added chain",
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
      features: ["eip155", "wallet_switchEthereumChain"],
      tags: ["user-added"],
      extensions: { source: "seed" },
    };

    const runtime = createRuntime({
      chainDefinitions: {
        seed: [mainnet, ALT_CHAIN as ChainMetadata, existing],
      },
    });
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    let approvalRequested = false;
    const unsubscribeApproval = runtime.controllers.approvals.onCreated(() => {
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
      expect(runtime.controllers.chainDefinitions.getChain(ADDED_CHAIN_REF)).toMatchObject({
        source: "builtin",
        metadata: {
          chainRef: existing.chainRef,
          displayName: existing.displayName,
          features: ["eip155"],
        },
      });
    } finally {
      unsubscribeApproval();
      runtime.lifecycle.destroy();
    }
  });

  it("rejects builtin wallet_addEthereumChain conflicts before approval", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    let approvalRequested = false;
    const unsubscribeApproval = runtime.controllers.approvals.onCreated(() => {
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
      ).rejects.toMatchObject({ code: 4902 });

      expect(approvalRequested).toBe(false);
    } finally {
      unsubscribeApproval();
      runtime.lifecycle.destroy();
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
      ).rejects.toMatchObject({ code: -32602 });
    } finally {
      runtime.lifecycle.destroy();
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
      runtime.lifecycle.destroy();
    }
  });

  it("returns EIP-2255 descriptors for wallet_getPermissions", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await runtime.controllers.permissions.grant(ORIGIN, PermissionCapabilities.Basic, { chainRef: chain.chainRef });
    await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
      chainRef: chain.chainRef,
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
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
      runtime.lifecycle.destroy();
    }
  });

  it("does not leak capability chains across different grants", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const main = getActiveChainMetadata(runtime);
    await waitForChainInNetwork(runtime, ALT_CHAIN.chainRef);

    await runtime.controllers.permissions.grant(ORIGIN, PermissionCapabilities.Basic, { chainRef: main.chainRef });
    await runtime.controllers.permissions.grant(ORIGIN, PermissionCapabilities.Basic, {
      chainRef: ALT_CHAIN.chainRef,
    });
    await runtime.controllers.permissions.grant(ORIGIN, PermissionCapabilities.Sign, { chainRef: ALT_CHAIN.chainRef });

    const execute = createExecutor(runtime);
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
      runtime.lifecycle.destroy();
    }
  });

  it("grants permissions after wallet_requestPermissions approval", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await runtime.services.session.vault.initialize({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });
    await runtime.services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

    const accountsController = runtime.controllers.accounts as unknown as { refresh?: () => Promise<void> };
    await accountsController.refresh?.();

    const teardown = setupApprovalResponder(runtime, async (task) => {
      if (task.kind !== ApprovalKinds.RequestPermissions) return false;
      const payload = task.request as RequestPermissionsApprovalPayload;
      expect(payload.requested).toEqual(
        expect.arrayContaining([
          { capability: "wallet_basic", chainRefs: [chain.chainRef] },
          { capability: "eth_accounts", chainRefs: [chain.chainRef] },
        ]),
      );
      await runtime.controllers.approvals.resolve({
        id: task.id,
        action: "approve",
        result: { granted: payload.requested },
      });
      return true;
    });

    const execute = createExecutor(runtime);
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

      const state = runtime.controllers.permissions.getPermissions(ORIGIN);
      const chainRef = runtime.controllers.network.getState().activeChainRef;
      expect(state?.eip155?.chains?.[chainRef]?.capabilities ?? []).toEqual(
        expect.arrayContaining([PermissionCapabilities.Basic, PermissionCapabilities.Accounts]),
      );
    } finally {
      teardown();
      runtime.lifecycle.destroy();
    }
  });

  it("returns [] for eth_accounts when wallet is unlocked but origin is not connected", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.vault.initialize({ password: "test" });
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
      runtime.lifecycle.destroy();
    }
  });

  it("returns permitted accounts for eth_accounts after connection persists per-chain accounts", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.vault.initialize({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    const chain = getActiveChainMetadata(runtime);
    const a1 = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
    const a2 = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";

    await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
      namespace: "eip155",
      chainRef: chain.chainRef,
      accounts: [a1, a2],
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
      runtime.lifecycle.destroy();
    }
  });

  it("rejects personal_sign when the requested account is not permitted for the origin", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
      namespace: "eip155",
      chainRef: chain.chainRef,
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    const execute = createExecutor(runtime);
    const requestApprovalSpy = vi.spyOn(runtime.controllers.approvals, "create");
    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: {
            method: "personal_sign",
            params: ["0xdeadbeef", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: 4100 });
      expect(requestApprovalSpy).not.toHaveBeenCalled();
    } finally {
      runtime.lifecycle.destroy();
    }
  });

  it("rejects eth_signTypedData_v4 when the requested account is not permitted for the origin", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
      namespace: "eip155",
      chainRef: chain.chainRef,
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    const execute = createExecutor(runtime);
    const requestApprovalSpy = vi.spyOn(runtime.controllers.approvals, "create");
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
      ).rejects.toMatchObject({ code: 4100 });
      expect(requestApprovalSpy).not.toHaveBeenCalled();
    } finally {
      runtime.lifecycle.destroy();
    }
  });

  it("rejects eth_sendTransaction when the from address is not permitted for the origin", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const chain = getActiveChainMetadata(runtime);
    await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
      namespace: "eip155",
      chainRef: chain.chainRef,
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    const execute = createExecutor(runtime);
    const txSpy = vi.spyOn(runtime.controllers.transactions, "requestTransactionApproval");
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
      ).rejects.toMatchObject({ code: 4100 });
      expect(txSpy).not.toHaveBeenCalled();
    } finally {
      runtime.lifecycle.destroy();
    }
  });
});
