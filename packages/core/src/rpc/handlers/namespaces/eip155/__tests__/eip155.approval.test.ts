import type { JsonRpcParams } from "@metamask/utils";
import { describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../../../../../accounts/addressing/accountKey.js";
import { ApprovalKinds, type TransactionMeta } from "../../../../../controllers/index.js";
import { TRANSACTION_STATUS_CHANGED } from "../../../../../controllers/transaction/topics.js";
import { MemoryNetworkSelectionPort } from "../../../../../runtime/__fixtures__/backgroundTestSetup.js";
import { TransactionAdapterRegistry } from "../../../../../transactions/adapters/registry.js";
import { createApprovalReadService } from "../../../../../ui/server/approvals/readService.js";
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

const createCrossChainSelectionPort = () =>
  new MemoryNetworkSelectionPort({
    id: "network-selection",
    selectedNamespace: "eip155",
    chainRefByNamespace: { eip155: ALT_CHAIN.chainRef },
    updatedAt: 0,
  });

const createReceiptTrackingStub = () => ({
  fetchReceipt: vi.fn(async () => null),
});

const getApprovalDetail = (runtime: ReturnType<typeof createRuntime>, approvalId: string) =>
  createApprovalReadService({
    approvals: runtime.controllers.approvals,
    accounts: runtime.controllers.accounts,
    chainViews: runtime.services.chainViews,
    transactions: runtime.controllers.transactions,
  }).getDetail(approvalId);

describe("eip155 handlers - approval metadata", () => {
  it("presents requestPermissions approvals as chain-scoped access requests", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    const activeChain = getActiveChainMetadata(runtime);
    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });
    await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });

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
      accountKey: selectableAccount.accountKey,
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
      expect(getApprovalDetail(runtime, task.approvalId)).toEqual({
        approvalId: task.approvalId,
        kind: ApprovalKinds.RequestPermissions,
        origin: ORIGIN,
        namespace: activeChain.namespace,
        chainRef: activeChain.chainRef,
        createdAt: task.createdAt,
        actions: {
          canApprove: true,
          canReject: true,
        },
        request: {
          selectableAccounts: selectableAccounts.map((account) => ({
            accountKey: account.accountKey,
            canonicalAddress: account.canonicalAddress,
            displayAddress: account.displayAddress,
          })),
          recommendedAccountKey: selectableAccount.accountKey,
          requestedGrants: [{ grantKind: "eth_accounts", chainRef: activeChain.chainRef }],
        },
        review: null,
      });

      void runtime.controllers.approvals.resolve({
        approvalId: task.approvalId,
        action: "reject",
        error: rejectionError,
      });
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
      runtime.lifecycle.shutdown();
    }
  });

  it("includes namespace metadata for eth_requestAccounts approvals", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    const execute = createExecutor(runtime);
    const activeChain = getActiveChainMetadata(runtime);
    const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
    const account = await runtime.services.keyring.deriveAccount(keyringId);
    const accountKey = toAccountKeyFromAddress({
      chainRef: activeChain.chainRef,
      address: account.address,
      accountCodecs: runtime.services.accountCodecs,
    });
    await runtime.controllers.accounts.setActiveAccount({
      namespace: activeChain.namespace,
      chainRef: activeChain.chainRef,
      accountKey,
    });

    let capturedTask: ReturnType<typeof runtime.controllers.approvals.get> | undefined;
    const unsubscribe = runtime.controllers.approvals.onCreated(({ record }) => {
      capturedTask = record;
      void runtime.controllers.approvals.resolve({
        approvalId: record.approvalId,
        action: "approve",
        decision: { accountKeys: [accountKey] },
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
      runtime.lifecycle.shutdown();
    }
  });

  it("presents personal_sign approvals on the selected chain", async () => {
    const runtime = createRuntime({
      networkSelection: { port: createCrossChainSelectionPort() },
    });
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    const selectedChain = runtime.services.chainViews.getSelectedChainView();
    const providerChain = runtime.services.chainViews.getActiveChainViewForNamespace("eip155");
    expect(providerChain.chainRef).toBe(ALT_CHAIN.chainRef);
    expect(selectedChain.chainRef).toBe(ALT_CHAIN.chainRef);
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
        await runtime.controllers.approvals.resolve({ approvalId: task.approvalId, action: "approve" });
        return true;
      }
      if (task.kind === ApprovalKinds.SignMessage) {
        capturedTask = task;
        expect(getApprovalDetail(runtime, task.approvalId)).toMatchObject({
          approvalId: task.approvalId,
          kind: ApprovalKinds.SignMessage,
          namespace: "eip155",
          chainRef: ALT_CHAIN.chainRef,
          request: {
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            message: "0xdeadbeef",
          },
          review: null,
        });
        void runtime.controllers.approvals.resolve({
          approvalId: task.approvalId,
          action: "reject",
          error: rejectionError,
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
      runtime.lifecycle.shutdown();
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
      void runtime.controllers.approvals.resolve({
        approvalId: task.approvalId,
        action: "reject",
        error: rejectionError,
      });
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
      runtime.lifecycle.shutdown();
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
      await runtime.controllers.approvals.resolve({ approvalId: task.approvalId, action: "approve" });
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
      runtime.lifecycle.shutdown();
    }
  });

  it("can present wallet_addEthereumChain approvals before the chain is registered", async () => {
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

      expect(getApprovalDetail(runtime, task.approvalId)).toMatchObject({
        approvalId: task.approvalId,
        kind: ApprovalKinds.AddChain,
        namespace: "eip155",
        chainRef: ADDED_CHAIN_REF,
        request: {
          chainRef: ADDED_CHAIN_REF,
          chainId: ADD_CHAIN_PARAMS.chainId,
          displayName: ADD_CHAIN_PARAMS.chainName,
          rpcUrls: ADD_CHAIN_PARAMS.rpcUrls,
          blockExplorerUrl: ADD_CHAIN_PARAMS.blockExplorerUrls[0],
          isUpdate: false,
        },
        review: null,
      });

      await runtime.controllers.approvals.resolve({ approvalId: task.approvalId, action: "approve" });
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
      runtime.lifecycle.shutdown();
    }
  });

  it("presents eth_sendTransaction approvals on the selected chain", async () => {
    const registry = new TransactionAdapterRegistry();
    registry.register("eip155", {
      prepareTransaction: vi.fn(async () => ({
        prepared: {},
        warnings: [],
        issues: [],
      })),
      signTransaction: vi.fn(async (_ctx, _prepared) => ({ raw: "0x", hash: null })),
      broadcastTransaction: vi.fn(async (_ctx, _signed) => ({ hash: "0x1111" })),
      receiptTracking: createReceiptTrackingStub(),
    });
    const runtime = createRuntime({
      networkSelection: { port: createCrossChainSelectionPort() },
      transactions: { registry },
    });
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    const execute = createExecutor(runtime);
    expect(runtime.services.chainViews.getSelectedChainView().chainRef).toBe(ALT_CHAIN.chainRef);
    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });
    const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
    const account = await runtime.services.keyring.deriveAccount(keyringId);
    await runtime.controllers.accounts.setActiveAccount({
      namespace: ALT_CHAIN.namespace,
      chainRef: ALT_CHAIN.chainRef,
      accountKey: toAccountKeyFromAddress({
        chainRef: ALT_CHAIN.chainRef,
        address: account.address,
        accountCodecs: runtime.services.accountCodecs,
      }),
    });
    await connectOrigin({
      runtime,
      chainRefs: [ALT_CHAIN.chainRef],
      addresses: [account.address],
    });

    let capturedTask: ReturnType<typeof runtime.controllers.approvals.get> | undefined;
    const rejectionError = Object.assign(new Error("User rejected the request."), { code: 4001 });
    const teardownApprovalResponder = setupApprovalResponder(runtime, (task) => {
      if (task.kind !== ApprovalKinds.SendTransaction) {
        return false;
      }
      capturedTask = task;
      expect(getApprovalDetail(runtime, task.approvalId)).toMatchObject({
        approvalId: task.approvalId,
        kind: ApprovalKinds.SendTransaction,
        namespace: "eip155",
        chainRef: ALT_CHAIN.chainRef,
        request: {
          transactionId: task.subject?.transactionId,
          chainRef: ALT_CHAIN.chainRef,
          origin: ORIGIN,
        },
        review: {
          namespaceReview: null,
        },
      });
      void runtime.controllers.approvals.resolve({
        approvalId: task.approvalId,
        action: "reject",
        error: rejectionError,
      });
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
                from: account.address,
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
      expect(capturedTask?.subject?.transactionId).toEqual(expect.any(String));
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.shutdown();
    }
  });

  it("maps signer-stage 4001 rejection to userRejected before broadcast for eth_sendTransaction", async () => {
    const registry = new TransactionAdapterRegistry();
    registry.register("eip155", {
      prepareTransaction: vi.fn(async () => ({
        prepared: {},
        warnings: [],
        issues: [],
      })),
      signTransaction: vi.fn(async () => {
        throw Object.assign(new Error("User rejected transaction"), {
          code: 4001,
          name: "TransactionRejectedError",
        });
      }),
      broadcastTransaction: vi.fn(async () => ({ hash: "0x1111" })),
      receiptTracking: createReceiptTrackingStub(),
    });

    const runtime = createRuntime({
      transactions: { registry },
    });
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    const mainnet = getActiveChainMetadata(runtime);
    const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
    const account = await runtime.services.keyring.deriveAccount(keyringId);
    await runtime.controllers.accounts.setActiveAccount({
      namespace: mainnet.namespace,
      chainRef: mainnet.chainRef,
      accountKey: toAccountKeyFromAddress({
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
    let capturedTask: ReturnType<typeof runtime.controllers.approvals.get> | undefined;
    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.kind !== ApprovalKinds.SendTransaction) {
        return false;
      }

      capturedTask = task;
      await runtime.controllers.approvals.resolve({ approvalId: task.approvalId, action: "approve" });
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
                from: account.address,
                to: account.address,
                value: "0x0",
                data: "0x",
              },
            ] as JsonRpcParams,
          },
        }),
      ).rejects.toMatchObject({ code: 4001 });

      expect(capturedTask?.approvalId).toEqual(expect.any(String));
      const failedMeta = runtime.controllers.transactions.getMeta(capturedTask?.subject?.transactionId ?? "");
      expect(failedMeta?.status).toBe("failed");
      expect(failedMeta?.userRejected).toBe(true);
      expect(failedMeta?.error?.code).toBe(4001);
      expect(failedMeta?.error?.name).toBe("TransactionRejectedError");
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.shutdown();
    }
  });

  it("returns a submission summary for eth_sendTransaction without mutating durable connection authorization", async () => {
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

    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    // Setup auto-approval for transactions
    const unsubscribe = runtime.controllers.approvals.onCreated(async ({ record: task }) => {
      try {
        if (task.kind === ApprovalKinds.SendTransaction) {
          await runtime.controllers.approvals.resolve({ approvalId: task.approvalId, action: "approve" });
        }
      } catch {
        // Ignore errors if approval was already resolved
      }
    });

    try {
      const execute = createExecutor(runtime);
      const mainnet = getActiveChainMetadata(runtime);

      const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
      const account = await runtime.services.keyring.deriveAccount(keyringId);
      await runtime.controllers.accounts.setActiveAccount({
        namespace: mainnet.namespace,
        chainRef: mainnet.chainRef,
        accountKey: toAccountKeyFromAddress({
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
      runtime.lifecycle.shutdown();
    }
  });

  it("signs personal_sign requests without mutating durable connection authorization", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.kind !== ApprovalKinds.SignMessage) {
        return false;
      }
      await runtime.controllers.approvals.resolve({ approvalId: task.approvalId, action: "approve" });
      return true;
    });
    try {
      const mainnet = getActiveChainMetadata(runtime);
      const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });

      const account = await runtime.services.keyring.deriveAccount(keyringId);
      await runtime.controllers.accounts.setActiveAccount({
        namespace: mainnet.namespace,
        chainRef: mainnet.chainRef,
        accountKey: toAccountKeyFromAddress({
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
        signPersonalMessage: (params: { accountKey: string; message: string }) => Promise<string>;
      }>("eip155");
      await expect(
        signer.signPersonalMessage({
          accountKey: toAccountKeyFromAddress({
            chainRef: mainnet.chainRef,
            address: account.address,
            accountCodecs: runtime.services.accountCodecs,
          }),
          message,
        }),
      ).resolves.toBe(signature);
      expect(runtime.controllers.permissions.getState()).toEqual(beforePermissions);
    } finally {
      teardownApprovalResponder();
      runtime.lifecycle.shutdown();
    }
  });

  it("signs eth_signTypedData_v4 requests without mutating durable connection authorization", async () => {
    const runtime = createRuntime();
    await runtime.lifecycle.initialize();
    runtime.lifecycle.start();

    await runtime.services.session.createVault({ password: "test" });
    await runtime.services.session.unlock.unlock({ password: "test" });

    const teardownApprovalResponder = setupApprovalResponder(runtime, async (task) => {
      if (task.kind !== ApprovalKinds.SignTypedData) {
        return false;
      }
      await runtime.controllers.approvals.resolve({ approvalId: task.approvalId, action: "approve" });
      return true;
    });
    try {
      const mainnet = getActiveChainMetadata(runtime);
      const { keyringId } = await runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });

      const account = await runtime.services.keyring.deriveAccount(keyringId);
      await runtime.controllers.accounts.setActiveAccount({
        namespace: mainnet.namespace,
        chainRef: mainnet.chainRef,
        accountKey: toAccountKeyFromAddress({
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
        signTypedData: (params: { accountKey: string; typedData: string }) => Promise<string>;
      }>("eip155");
      await expect(
        signer.signTypedData({
          accountKey: toAccountKeyFromAddress({
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
      runtime.lifecycle.shutdown();
    }
  });
});
