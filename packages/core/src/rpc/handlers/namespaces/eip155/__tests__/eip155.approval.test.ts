import type { JsonRpcParams } from "@metamask/utils";
import { describe, expect, it, vi } from "vitest";
import { ApprovalTypes, PermissionScopes } from "../../../../../controllers/index.js";
import { TransactionAdapterRegistry } from "../../../../../transactions/adapters/registry.js";
import {
  ADD_CHAIN_PARAMS,
  ADDED_CHAIN_REF,
  createExecutor,
  createServices,
  ORIGIN,
  setupApprovalResponder,
  TEST_MNEMONIC,
} from "./eip155.test.helpers.js";

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
    const rejectionError = Object.assign(
      new Error("The requested method and/or account has not been authorized by the user."),
      { code: 4100 },
    );
    const teardownApprovalResponder = setupApprovalResponder(services, async (task) => {
      if (task.type === ApprovalTypes.RequestAccounts) {
        await services.controllers.approvals.resolve(task.id, async () => []);
        return true;
      }
      if (task.type === ApprovalTypes.SignMessage) {
        capturedTask = task;
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
            method: "personal_sign",
            params: ["0xdeadbeef", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: 4100 });

      expect(capturedTask?.namespace).toBe("eip155");
      expect(capturedTask?.chainRef).toBe(activeChain.chainRef);
    } finally {
      teardownApprovalResponder();
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
    const rejectionError = Object.assign(
      new Error("The requested method and/or account has not been authorized by the user."),
      { code: 4100 },
    );
    const teardownApprovalResponder = setupApprovalResponder(services, (task) => {
      if (task.type !== ApprovalTypes.SignTypedData) {
        return false;
      }
      capturedTask = task;
      services.controllers.approvals.reject(task.id, rejectionError);
      return true;
    });

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
      teardownApprovalResponder();
      services.lifecycle.destroy();
    }
  });

  it("includes chain metadata for wallet_addEthereumChain approvals", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);

    let capturedTask: Parameters<typeof services.controllers.approvals.requestApproval>[0] | undefined;
    const teardownApprovalResponder = setupApprovalResponder(services, async (task) => {
      if (task.type !== ApprovalTypes.AddChain) {
        return false;
      }
      capturedTask = task;
      await services.controllers.approvals.resolve(task.id, async () => null);
      return true;
    });

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
      teardownApprovalResponder();
      services.lifecycle.destroy();
    }
  });

  it("includes namespace metadata for eth_sendTransaction approvals", async () => {
    const registry = new TransactionAdapterRegistry();
    registry.register("eip155", {
      prepareTransaction: vi.fn(async () => ({
        prepared: {},
        warnings: [],
        issues: [],
      })),
      signTransaction: vi.fn(async (_ctx, _prepared) => ({ raw: "0x", hash: null })),
      broadcastTransaction: vi.fn(async (_ctx, _signed) => ({ hash: "0x1111" })),
    });
    const services = createServices({
      transactions: { registry },
    });
    await services.lifecycle.initialize();
    services.lifecycle.start();

    const execute = createExecutor(services);
    const activeChain = services.controllers.network.getActiveChain();

    let capturedTask: Parameters<typeof services.controllers.approvals.requestApproval>[0] | undefined;
    const rejectionError = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const teardownApprovalResponder = setupApprovalResponder(services, (task) => {
      if (task.type !== ApprovalTypes.SendTransaction) {
        return false;
      }
      capturedTask = task;
      services.controllers.approvals.reject(task.id, rejectionError);
      return true;
    });

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
      teardownApprovalResponder();
      services.lifecycle.destroy();
    }
  });

  it("returns a submission summary when eth_sendTransaction auto-approves", async () => {
    const rpcMocks = {
      estimateGas: vi.fn(async () => "0x5208"),
      getBalance: vi.fn(async () => "0xffffffffffffffff"),
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
      getBalance: rpcMocks.getBalance,
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
    const unsubscribe = services.controllers.approvals.onRequest(async ({ task }) => {
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

      let broadcastMeta: {
        id: string;
        status: string;
        hash: string | null;
        namespace: string;
        chainRef: string;
        from: string | null;
        warnings: any[];
        issues: any[];
      } | null = null;
      const unsubscribeTx = services.messenger.subscribe("transaction:statusChanged", (event) => {
        if (event.nextStatus === "broadcast") {
          broadcastMeta = event.meta as any;
        }
      });

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

      unsubscribeTx();

      expect(broadcastMeta).not.toBeNull();
      expect(broadcastMeta!.id).toEqual(expect.any(String));
      expect(broadcastMeta!.status).toBe("broadcast");
      expect(broadcastMeta!.hash).toBe(txHash);
      expect(broadcastMeta!.namespace).toBe("eip155");
      expect(broadcastMeta!.chainRef).toBe(mainnet.chainRef);
      expect(broadcastMeta!.from).toBe(account.address);
      expect(broadcastMeta!.warnings).toEqual([]);
      expect(broadcastMeta!.issues).toEqual([]);
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

    const teardownApprovalResponder = setupApprovalResponder(services, async (task) => {
      if (task.type !== ApprovalTypes.SignMessage) {
        return false;
      }
      const payload = task.payload as { from: string; message: string };
      await services.controllers.approvals.resolve(task.id, async () =>
        services.controllers.signers.eip155.signPersonalMessage({
          address: payload.from,
          message: payload.message,
        }),
      );
      return true;
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
      expect(signature.length).toBe(132);
      await expect(
        services.controllers.signers.eip155.signPersonalMessage({ address: account.address, message }),
      ).resolves.toBe(signature);
    } finally {
      teardownApprovalResponder();
      services.lifecycle.destroy();
    }
  });

  it("signs eth_signTypedData_v4 requests with the eip155 signer", async () => {
    const services = createServices();
    await services.lifecycle.initialize();
    services.lifecycle.start();

    await services.session.vault.initialize({ password: "test" });
    await services.session.unlock.unlock({ password: "test" });

    const teardownApprovalResponder = setupApprovalResponder(services, async (task) => {
      if (task.type !== ApprovalTypes.SignTypedData) {
        return false;
      }
      const payload = task.payload as { from: string; typedData: string };
      await services.controllers.approvals.resolve(task.id, async () =>
        services.controllers.signers.eip155.signTypedData({
          address: payload.from,
          typedData: payload.typedData,
        }),
      );
      return true;
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
    } finally {
      teardownApprovalResponder();
      services.lifecycle.destroy();
    }
  });
});
