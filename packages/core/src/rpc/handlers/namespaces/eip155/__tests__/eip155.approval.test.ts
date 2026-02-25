import type { JsonRpcParams } from "@metamask/utils";
import { describe, expect, it, vi } from "vitest";
import { toAccountIdFromAddress } from "../../../../../accounts/accountId.js";
import { ApprovalTypes, PermissionCapabilities } from "../../../../../controllers/index.js";
import { TRANSACTION_STATUS_CHANGED } from "../../../../../controllers/transaction/topics.js";
import { TransactionAdapterRegistry } from "../../../../../transactions/adapters/registry.js";
import {
  ADD_CHAIN_PARAMS,
  ADDED_CHAIN_REF,
  createExecutor,
  createRuntime,
  ORIGIN,
  setupApprovalResponder,
  TEST_MNEMONIC,
} from "./eip155.test.helpers.js";

describe("eip155 handlers - approval metadata", () => {
  it("includes namespace metadata for eth_requestAccounts approvals", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    const activeChain = runtime.controllers.network.getActiveChain();

    let capturedTask: Parameters<typeof runtime.controllers.approvals.requestApproval>[0] | undefined;
    const originalRequestApproval = runtime.controllers.approvals.requestApproval;
    runtime.controllers.approvals.requestApproval = (async (task) => {
      capturedTask = task;
      // Return empty array directly instead of calling original method
      // This test only needs to verify the approval task metadata, not actually approve
      return [];
    }) as typeof runtime.controllers.approvals.requestApproval;

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
      runtime.controllers.approvals.requestApproval = originalRequestApproval;
      runtime.lifecycle.destroy();
    }
  });

  it("includes namespace metadata for personal_sign approvals", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    const activeChain = runtime.controllers.network.getActiveChain();
    await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
      namespace: "eip155",
      chainRef: activeChain.chainRef,
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    let capturedTask: Parameters<typeof runtime.controllers.approvals.requestApproval>[0] | undefined;
    const rejectionError = Object.assign(
      new Error("The requested method and/or account has not been authorized by the user."),
      { code: 4100 },
    );
    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.type === ApprovalTypes.RequestAccounts) {
        await runtime.controllers.approvals.resolve(task.id, async () => []);
        return true;
      }
      if (task.type === ApprovalTypes.SignMessage) {
        capturedTask = task;
        runtime.controllers.approvals.reject(task.id, rejectionError);
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
      runtime.lifecycle.destroy();
    }
  });

  it("includes namespace metadata for eth_signTypedData_v4 approvals", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    const activeChain = runtime.controllers.network.getActiveChain();
    await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
      namespace: "eip155",
      chainRef: activeChain.chainRef,
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    let capturedTask: Parameters<typeof runtime.controllers.approvals.requestApproval>[0] | undefined;
    const rejectionError = Object.assign(
      new Error("The requested method and/or account has not been authorized by the user."),
      { code: 4100 },
    );
    const teardownApprovalResponder = setupApprovalResponder(runtime, (task) => {
      if (task.type !== ApprovalTypes.SignTypedData) {
        return false;
      }
      capturedTask = task;
      runtime.controllers.approvals.reject(task.id, rejectionError);
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
      runtime.lifecycle.destroy();
    }
  });

  it("includes chain metadata for wallet_addEthereumChain approvals", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);

    let capturedTask: Parameters<typeof runtime.controllers.approvals.requestApproval>[0] | undefined;
    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.type !== ApprovalTypes.AddChain) {
        return false;
      }
      capturedTask = task;
      await runtime.controllers.approvals.resolve(task.id, async () => null);
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
      runtime.lifecycle.destroy();
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
    const runtime = createRuntime({
      transactions: { registry },
    });
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    const activeChain = runtime.controllers.network.getActiveChain();
    await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
      namespace: "eip155",
      chainRef: activeChain.chainRef,
      accounts: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    let capturedTask: Parameters<typeof runtime.controllers.approvals.requestApproval>[0] | undefined;
    const rejectionError = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const teardownApprovalResponder = setupApprovalResponder(runtime, (task) => {
      if (task.type !== ApprovalTypes.SendTransaction) {
        return false;
      }
      capturedTask = task;
      runtime.controllers.approvals.reject(task.id, rejectionError);
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
      runtime.lifecycle.destroy();
    }
  });

  it("returns a submission summary when eth_sendTransaction auto-approves", async () => {
    const rpcMocks = {
      estimateGas: vi.fn(async () => "0x5208"),
      getBalance: vi.fn(async () => "0xffffffffffffffff"),
      getTransactionCount: vi.fn(async () => "0x1"),
      getGasPrice: vi.fn(async () => "0x3b9aca00"),
      getMaxPriorityFeePerGas: vi.fn(async () => "0x1"),
      getBlockByNumber: vi.fn(async () => ({ baseFeePerGas: "0x1" })),
      sendRawTransaction: vi.fn(async () => "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      getTransactionReceipt: vi.fn(async () => null),
    };
    const rpcFactory = vi.fn(() => ({
      request: vi.fn(),
      estimateGas: rpcMocks.estimateGas,
      getBalance: rpcMocks.getBalance,
      getTransactionCount: rpcMocks.getTransactionCount,
      getGasPrice: rpcMocks.getGasPrice,
      getMaxPriorityFeePerGas: rpcMocks.getMaxPriorityFeePerGas,
      getBlockByNumber: rpcMocks.getBlockByNumber,
      sendRawTransaction: rpcMocks.sendRawTransaction,
      getTransactionReceipt: rpcMocks.getTransactionReceipt,
    }));

    const runtime = createRuntime({
      transactions: { registry: new TransactionAdapterRegistry() },
      rpcClients: {
        factories: [{ namespace: "eip155", factory: rpcFactory }],
      },
    });

    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.vault.initialize({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    // Setup auto-approval for transactions
    const unsubscribe = runtime.controllers.approvals.onRequest(async ({ task }) => {
      try {
        if (task.type === "wallet_sendTransaction") {
          const result = await runtime.controllers.transactions.approveTransaction(task.id);
          await runtime.controllers.approvals.resolve(task.id, async () => result);
        }
      } catch {
        // Ignore errors if approval was already resolved
      }
    });

    try {
      const execute = createExecutor(runtime);
      const mainnet = runtime.controllers.network.getActiveChain();

      const { keyringId } = await runtime.services.keyring.confirmNewMnemonic(TEST_MNEMONIC);
      const account = await runtime.services.keyring.deriveAccount(keyringId);
      await runtime.controllers.accounts.switchActive({ chainRef: mainnet.chainRef, address: account.address });
      await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
        namespace: "eip155",
        chainRef: mainnet.chainRef,
        accounts: [account.address],
      });

      // Grant basic scope only; transaction scope should be added after a successful send.
      await runtime.controllers.permissions.grant(ORIGIN, PermissionCapabilities.Basic, {
        namespace: "eip155",
        chainRef: mainnet.chainRef,
      });

      const beforePermissions = runtime.controllers.permissions.getState();
      const beforeCapabilities =
        beforePermissions.origins[ORIGIN]?.eip155?.chains[mainnet.chainRef]?.capabilities ?? [];
      expect(beforeCapabilities).not.toContain(PermissionCapabilities.SendTransaction);

      let broadcastMeta: {
        id: string;
        status: string;
        hash: string | null;
        namespace: string;
        chainRef: string;
        from: string | null;
        warnings: unknown[];
        issues: unknown[];
      } | null = null;
      const unsubscribeTx = runtime.bus.subscribe(TRANSACTION_STATUS_CHANGED, (event) => {
        if (event.nextStatus === "broadcast") {
          broadcastMeta = event.meta as unknown as NonNullable<typeof broadcastMeta>;
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

      if (!broadcastMeta) throw new Error("Expected broadcast meta to be captured");
      expect(broadcastMeta.id).toEqual(expect.any(String));
      expect(broadcastMeta.status).toBe("broadcast");
      expect(broadcastMeta.hash).toBe(txHash);
      expect(broadcastMeta.namespace).toBe("eip155");
      expect(broadcastMeta.chainRef).toBe(mainnet.chainRef);
      expect(broadcastMeta.from).toBe(account.address);
      expect(broadcastMeta.warnings).toEqual([]);
      expect(broadcastMeta.issues).toEqual([]);
      expect(rpcMocks.sendRawTransaction).toHaveBeenCalledTimes(1);

      const afterPermissions = runtime.controllers.permissions.getState();
      const afterCapabilities = afterPermissions.origins[ORIGIN]?.eip155?.chains[mainnet.chainRef]?.capabilities ?? [];
      expect(afterCapabilities).toContain(PermissionCapabilities.SendTransaction);
    } finally {
      unsubscribe();
      runtime.lifecycle.destroy();
    }
  });

  it("signs personal_sign requests when the account is unlocked", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.vault.initialize({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.type !== ApprovalTypes.SignMessage) {
        return false;
      }
      const payload = task.payload as { from: string; message: string };
      await runtime.controllers.approvals.resolve(task.id, async () =>
        runtime.controllers.signers.eip155.signPersonalMessage({
          accountId: toAccountIdFromAddress({
            chainRef: runtime.controllers.network.getActiveChain().chainRef,
            address: payload.from,
          }),
          message: payload.message,
        }),
      );
      return true;
    });
    try {
      const mainnet = runtime.controllers.network.getActiveChain();
      const { keyringId } = await runtime.services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

      const account = await runtime.services.keyring.deriveAccount(keyringId);
      await runtime.controllers.accounts.switchActive({ chainRef: mainnet.chainRef, address: account.address });
      await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
        namespace: "eip155",
        chainRef: mainnet.chainRef,
        accounts: [account.address],
      });

      const execute = createExecutor(runtime);
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
        runtime.controllers.signers.eip155.signPersonalMessage({
          accountId: toAccountIdFromAddress({ chainRef: mainnet.chainRef, address: account.address }),
          message,
        }),
      ).resolves.toBe(signature);
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.destroy();
    }
  });

  it("signs eth_signTypedData_v4 requests with the eip155 signer", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.vault.initialize({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.type !== ApprovalTypes.SignTypedData) {
        return false;
      }
      const payload = task.payload as { from: string; typedData: string };
      await runtime.controllers.approvals.resolve(task.id, async () =>
        runtime.controllers.signers.eip155.signTypedData({
          accountId: toAccountIdFromAddress({
            chainRef: runtime.controllers.network.getActiveChain().chainRef,
            address: payload.from,
          }),
          typedData: payload.typedData,
        }),
      );
      return true;
    });
    try {
      const mainnet = runtime.controllers.network.getActiveChain();
      const { keyringId } = await runtime.services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

      const account = await runtime.services.keyring.deriveAccount(keyringId);
      await runtime.controllers.accounts.switchActive({ chainRef: mainnet.chainRef, address: account.address });
      await runtime.controllers.permissions.setPermittedAccounts(ORIGIN, {
        namespace: "eip155",
        chainRef: mainnet.chainRef,
        accounts: [account.address],
      });

      // Ensure Sign scope is not present before the first typed data signature.
      const beforeState = runtime.controllers.permissions.getState();
      const beforeCapabilities = beforeState.origins[ORIGIN]?.eip155?.chains[mainnet.chainRef]?.capabilities ?? [];
      expect(beforeCapabilities).not.toContain(PermissionCapabilities.Sign);

      const execute = createExecutor(runtime);
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
        runtime.controllers.signers.eip155.signTypedData({
          accountId: toAccountIdFromAddress({ chainRef: mainnet.chainRef, address: account.address }),
          typedData,
        }),
      ).resolves.toBe(signature);
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.destroy();
    }
  });
});
