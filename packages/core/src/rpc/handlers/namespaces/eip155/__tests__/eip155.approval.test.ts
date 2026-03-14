import type { JsonRpcParams } from "@metamask/utils";
import { describe, expect, it, vi } from "vitest";
import { toAccountIdFromAddress } from "../../../../../accounts/addressing/accountId.js";
import { createApprovalFlowRegistry } from "../../../../../approvals/index.js";
import { ApprovalKinds, type TransactionMeta } from "../../../../../controllers/index.js";
import { TRANSACTION_STATUS_CHANGED } from "../../../../../controllers/transaction/topics.js";
import { MemoryNetworkPreferencesPort } from "../../../../../runtime/__fixtures__/backgroundTestSetup.js";
import { TransactionAdapterRegistry } from "../../../../../transactions/adapters/registry.js";
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
  TEST_MNEMONIC,
} from "./eip155.test.helpers.js";

const createCrossChainPreferencesPort = () =>
  new MemoryNetworkPreferencesPort({
    id: "network-preferences",
    selectedChainRef: "eip155:1",
    activeChainByNamespace: { eip155: ALT_CHAIN.chainRef },
    rpc: {},
    updatedAt: 0,
  });

describe("eip155 handlers - approval metadata", () => {
  it("presents requestPermissions approvals as chain-scoped access requests", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const approvalRegistry = createApprovalFlowRegistry();
    const execute = createExecutor(runtime);
    const activeChain = getActiveChainMetadata(runtime);
    await runtime.services.session.vault.initialize({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });
    await runtime.services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

    const accountsController = runtime.controllers.accounts as unknown as { refresh?: () => Promise<void> };
    await accountsController.refresh?.();
    const selectableAccounts = runtime.controllers.accounts.listOwnedForNamespace({
      namespace: activeChain.namespace,
      chainRef: activeChain.chainRef,
    });
    expect(selectableAccounts.length).toBeGreaterThan(0);
    const [selectableAccount] = selectableAccounts;
    await runtime.controllers.accounts.setActiveAccount({
      namespace: activeChain.namespace,
      chainRef: activeChain.chainRef,
      accountId: selectableAccount.accountId,
    });

    let capturedTask: ReturnType<typeof runtime.controllers.approvals.get> | undefined;
    const rejectionError = Object.assign(
      new Error("The requested method and/or account has not been authorized by the user."),
      { code: 4100 },
    );
    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.kind !== ApprovalKinds.RequestPermissions) {
        return false;
      }

      capturedTask = task;
      const summary = approvalRegistry.present(task, {
        accounts: runtime.controllers.accounts,
        chainViews: runtime.services.chainViews,
        transactions: runtime.controllers.transactions,
      });

      expect(summary).toEqual({
        id: task.id,
        type: "requestPermissions",
        origin: ORIGIN,
        namespace: activeChain.namespace,
        chainRef: activeChain.chainRef,
        createdAt: task.createdAt,
        payload: {
          selectableAccounts: selectableAccounts.map((account) => ({
            accountId: account.accountId,
            canonicalAddress: account.canonicalAddress,
            displayAddress: account.displayAddress,
          })),
          recommendedAccountId: selectableAccount.accountId,
          requestedAccesses: [{ capability: "eth_accounts", chainRef: activeChain.chainRef }],
        },
      });

      void runtime.controllers.approvals.resolve({ id: task.id, action: "reject", error: rejectionError });
      return true;
    });

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] as JsonRpcParams },
        }),
      ).rejects.toMatchObject({ code: 4100 });

      expect(capturedTask?.namespace).toBe(activeChain.namespace);
      expect(capturedTask?.chainRef).toBe(activeChain.chainRef);
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.destroy();
    }
  });

  it("includes namespace metadata for eth_requestAccounts approvals", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.vault.initialize({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    const execute = createExecutor(runtime);
    const activeChain = getActiveChainMetadata(runtime);
    const { keyringId } = await runtime.services.keyring.confirmNewMnemonic(TEST_MNEMONIC);
    const account = await runtime.services.keyring.deriveAccount(keyringId);
    const accountId = toAccountIdFromAddress({
      chainRef: activeChain.chainRef,
      address: account.address,
      accountCodecs: runtime.services.accountCodecs,
    });
    await runtime.controllers.accounts.setActiveAccount({
      namespace: activeChain.namespace,
      chainRef: activeChain.chainRef,
      accountId,
    });

    let capturedTask: ReturnType<typeof runtime.controllers.approvals.get> | undefined;
    const unsubscribe = runtime.controllers.approvals.onCreated(({ record }) => {
      capturedTask = record;
      void runtime.controllers.approvals.resolve({
        id: record.id,
        action: "approve",
        decision: { accountIds: [accountId] },
      });
    });

    try {
      const accounts = (await execute({
        origin: ORIGIN,
        request: { method: "eth_requestAccounts", params: [] as JsonRpcParams },
      })) as string[];
      expect(accounts.map((value) => value.toLowerCase())).toEqual([account.address.toLowerCase()]);

      expect(capturedTask?.namespace).toBe("eip155");
      expect(capturedTask?.chainRef).toBe(activeChain.chainRef);
    } finally {
      unsubscribe();
      runtime.lifecycle.destroy();
    }
  });

  it("presents personal_sign approvals on the derived review chain when wallet selected chain differs", async () => {
    const runtime = createRuntime({
      networkPreferences: { port: createCrossChainPreferencesPort() },
    });
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const approvalRegistry = createApprovalFlowRegistry();
    const execute = createExecutor(runtime);
    const selectedChain = runtime.services.chainViews.getSelectedChainView();
    const providerChain = runtime.services.chainViews.getProviderChainView("eip155");
    expect(selectedChain.chainRef).toBe("eip155:1");
    expect(providerChain.chainRef).toBe(ALT_CHAIN.chainRef);
    await connectOrigin({
      runtime,
      chainRefs: [ALT_CHAIN.chainRef],
      addresses: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    let capturedTask: ReturnType<typeof runtime.controllers.approvals.get> | undefined;
    const rejectionError = Object.assign(
      new Error("The requested method and/or account has not been authorized by the user."),
      { code: 4100 },
    );
    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.kind === ApprovalKinds.RequestAccounts) {
        await runtime.controllers.approvals.resolve({ id: task.id, action: "approve" });
        return true;
      }
      if (task.kind === ApprovalKinds.SignMessage) {
        capturedTask = task;
        const summary = approvalRegistry.present(task, {
          accounts: runtime.controllers.accounts,
          chainViews: runtime.services.chainViews,
          transactions: runtime.controllers.transactions,
        });
        expect(summary).toMatchObject({
          type: "signMessage",
          namespace: "eip155",
          chainRef: ALT_CHAIN.chainRef,
        });
        expect(summary.chainRef).not.toBe(selectedChain.chainRef);
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
            method: "personal_sign",
            params: ["0xdeadbeef", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] as JsonRpcParams,
          },
          context: { chainRef: ALT_CHAIN.chainRef },
        }),
      ).rejects.toMatchObject({ code: 4100 });

      expect(capturedTask?.namespace).toBe("eip155");
      expect(capturedTask?.chainRef).toBe(ALT_CHAIN.chainRef);
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
    const activeChain = getActiveChainMetadata(runtime);
    await connectOrigin({
      runtime,
      chainRefs: [activeChain.chainRef],
      addresses: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    let capturedTask: ReturnType<typeof runtime.controllers.approvals.get> | undefined;
    const rejectionError = Object.assign(
      new Error("The requested method and/or account has not been authorized by the user."),
      { code: 4100 },
    );
    const teardownApprovalResponder = setupApprovalResponder(runtime, (task) => {
      if (task.kind !== ApprovalKinds.SignTypedData) {
        return false;
      }
      capturedTask = task;
      void runtime.controllers.approvals.resolve({ id: task.id, action: "reject", error: rejectionError });
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

    let capturedTask: ReturnType<typeof runtime.controllers.approvals.get> | undefined;
    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.kind !== ApprovalKinds.AddChain) {
        return false;
      }
      capturedTask = task;
      await runtime.controllers.approvals.resolve({ id: task.id, action: "approve" });
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

  it("can present wallet_addEthereumChain approvals before the chain is registered", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    const registry = createApprovalFlowRegistry();

    let capturedTask: ReturnType<typeof runtime.controllers.approvals.get> | undefined;
    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.kind !== ApprovalKinds.AddChain) {
        return false;
      }

      capturedTask = task;

      const summary = registry.present(task, {
        accounts: runtime.controllers.accounts,
        chainViews: runtime.services.chainViews,
        transactions: runtime.controllers.transactions,
      });

      expect(summary).toMatchObject({
        type: "addChain",
        namespace: "eip155",
        chainRef: ADDED_CHAIN_REF,
        payload: {
          chainRef: ADDED_CHAIN_REF,
          displayName: ADD_CHAIN_PARAMS.chainName,
        },
      });

      await runtime.controllers.approvals.resolve({ id: task.id, action: "approve" });
      return true;
    });

    try {
      await expect(
        execute({
          origin: ORIGIN,
          request: { method: "wallet_addEthereumChain", params: [ADD_CHAIN_PARAMS] as JsonRpcParams },
        }),
      ).resolves.toBeNull();

      expect(capturedTask?.chainRef).toBe(ADDED_CHAIN_REF);
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.destroy();
    }
  });

  it("presents eth_sendTransaction approvals on the derived review chain when wallet selected chain differs", async () => {
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
      networkPreferences: { port: createCrossChainPreferencesPort() },
      transactions: { registry },
    });
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const approvalRegistry = createApprovalFlowRegistry();
    const execute = createExecutor(runtime);
    const selectedChain = runtime.services.chainViews.getSelectedChainView();
    expect(selectedChain.chainRef).toBe("eip155:1");
    await connectOrigin({
      runtime,
      chainRefs: [ALT_CHAIN.chainRef],
      addresses: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });

    let capturedTask: ReturnType<typeof runtime.controllers.approvals.get> | undefined;
    const rejectionError = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const teardownApprovalResponder = setupApprovalResponder(runtime, (task) => {
      if (task.kind !== ApprovalKinds.SendTransaction) {
        return false;
      }
      capturedTask = task;
      const summary = approvalRegistry.present(task, {
        accounts: runtime.controllers.accounts,
        chainViews: runtime.services.chainViews,
        transactions: runtime.controllers.transactions,
      });
      expect(summary).toMatchObject({
        type: "sendTransaction",
        namespace: "eip155",
        chainRef: ALT_CHAIN.chainRef,
      });
      expect(summary.chainRef).not.toBe(selectedChain.chainRef);
      void runtime.controllers.approvals.resolve({ id: task.id, action: "reject", error: rejectionError });
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
          context: { chainRef: ALT_CHAIN.chainRef },
        }),
      ).rejects.toMatchObject({ code: 4001 });

      expect(capturedTask?.namespace).toBe("eip155");
      expect(capturedTask?.chainRef).toBe(ALT_CHAIN.chainRef);
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
    const unsubscribe = runtime.controllers.approvals.onCreated(async ({ record: task }) => {
      try {
        if (task.kind === ApprovalKinds.SendTransaction) {
          await runtime.controllers.approvals.resolve({ id: task.id, action: "approve" });
        }
      } catch {
        // Ignore errors if approval was already resolved
      }
    });

    try {
      const execute = createExecutor(runtime);
      const mainnet = getActiveChainMetadata(runtime);

      const { keyringId } = await runtime.services.keyring.confirmNewMnemonic(TEST_MNEMONIC);
      const account = await runtime.services.keyring.deriveAccount(keyringId);
      await runtime.controllers.accounts.setActiveAccount({
        namespace: mainnet.namespace,
        chainRef: mainnet.chainRef,
        accountId: toAccountIdFromAddress({
          chainRef: mainnet.chainRef,
          address: account.address,
          accountCodecs: runtime.services.accountCodecs,
        }),
      });
      await connectOrigin({
        runtime,
        chainRefs: [mainnet.chainRef],
        addresses: [account.address],
      });

      const beforePermissions = runtime.controllers.permissions.getState();

      const broadcastMetaPromise = new Promise<TransactionMeta>((resolve) => {
        const unsubscribeTx = runtime.bus.subscribe(TRANSACTION_STATUS_CHANGED, (event) => {
          if (event.nextStatus !== "broadcast") {
            return;
          }

          unsubscribeTx();
          resolve(event.meta);
        });
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
      const broadcastMeta = await broadcastMetaPromise;
      expect(broadcastMeta.id).toEqual(expect.any(String));
      expect(broadcastMeta.status).toBe("broadcast");
      expect(broadcastMeta.hash).toBe(txHash);
      expect(broadcastMeta.namespace).toBe("eip155");
      expect(broadcastMeta.chainRef).toBe(mainnet.chainRef);
      expect(broadcastMeta.from).toBe(account.address);
      expect(broadcastMeta.warnings).toEqual([]);
      expect(broadcastMeta.issues).toEqual([]);
      expect(rpcMocks.sendRawTransaction).toHaveBeenCalledTimes(1);
      expect(runtime.controllers.permissions.getState()).toEqual(beforePermissions);
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
      if (task.kind !== ApprovalKinds.SignMessage) {
        return false;
      }
      await runtime.controllers.approvals.resolve({ id: task.id, action: "approve" });
      return true;
    });
    try {
      const mainnet = getActiveChainMetadata(runtime);
      const { keyringId } = await runtime.services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

      const account = await runtime.services.keyring.deriveAccount(keyringId);
      await runtime.controllers.accounts.setActiveAccount({
        namespace: mainnet.namespace,
        chainRef: mainnet.chainRef,
        accountId: toAccountIdFromAddress({
          chainRef: mainnet.chainRef,
          address: account.address,
          accountCodecs: runtime.services.accountCodecs,
        }),
      });
      await connectOrigin({
        runtime,
        chainRefs: [mainnet.chainRef],
        addresses: [account.address],
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
      const signer = runtime.controllers.signers.require<{
        signPersonalMessage: (params: { accountId: string; message: string }) => Promise<string>;
      }>("eip155");
      await expect(
        signer.signPersonalMessage({
          accountId: toAccountIdFromAddress({
            chainRef: mainnet.chainRef,
            address: account.address,
            accountCodecs: runtime.services.accountCodecs,
          }),
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
      if (task.kind !== ApprovalKinds.SignTypedData) {
        return false;
      }
      await runtime.controllers.approvals.resolve({ id: task.id, action: "approve" });
      return true;
    });
    try {
      const mainnet = getActiveChainMetadata(runtime);
      const { keyringId } = await runtime.services.keyring.confirmNewMnemonic(TEST_MNEMONIC);

      const account = await runtime.services.keyring.deriveAccount(keyringId);
      await runtime.controllers.accounts.setActiveAccount({
        namespace: mainnet.namespace,
        chainRef: mainnet.chainRef,
        accountId: toAccountIdFromAddress({
          chainRef: mainnet.chainRef,
          address: account.address,
          accountCodecs: runtime.services.accountCodecs,
        }),
      });
      await connectOrigin({
        runtime,
        chainRefs: [mainnet.chainRef],
        addresses: [account.address],
      });
      const beforeState = runtime.controllers.permissions.getState();

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
      const signer = runtime.controllers.signers.require<{
        signTypedData: (params: { accountId: string; typedData: string }) => Promise<string>;
      }>("eip155");
      await expect(
        signer.signTypedData({
          accountId: toAccountIdFromAddress({
            chainRef: mainnet.chainRef,
            address: account.address,
            accountCodecs: runtime.services.accountCodecs,
          }),
          typedData,
        }),
      ).resolves.toBe(signature);
      expect(runtime.controllers.permissions.getState()).toEqual(beforeState);
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.destroy();
    }
  });
});
