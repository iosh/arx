import { describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../../accounts/addressing/accountKey.js";
import { createAccountCodecRegistry, eip155Codec } from "../../accounts/addressing/codec.js";
import type { TransactionRecord } from "../../storage/records.js";
import { TransactionExecutor } from "./TransactionExecutor.js";
import type { TransactionMeta } from "./types.js";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_CONTEXT = {
  transport: "provider" as const,
  origin: "https://dapp.example",
  portId: "port-1",
  sessionId: "session-1",
  requestId: "request-1",
};
const accountCodecs = createAccountCodecRegistry([eip155Codec]);
const createReceiptTrackingStub = () => ({
  fetchReceipt: vi.fn(async () => null),
});

const toMeta = (record: TransactionRecord, from: string): TransactionMeta => ({
  id: record.id,
  namespace: record.namespace,
  chainRef: record.chainRef,
  origin: record.origin,
  from,
  request: record.request,
  prepared: null,
  status: record.status,
  hash: record.hash,
  receipt: null,
  error: null,
  userRejected: record.userRejected,
  warnings: record.warnings,
  issues: record.issues,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

describe("TransactionExecutor", () => {
  it("begins a transaction approval with aligned transaction and approval ids", async () => {
    const chainRef = "eip155:10";
    const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const accountKey = toAccountKeyFromAddress({ chainRef, address: from, accountCodecs });

    const createdRecord: TransactionRecord = {
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef,
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      status: "pending",
      request: {
        namespace: "eip155",
        chainRef,
        payload: {
          from,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
          chainId: "0xa",
        },
      },
      hash: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1,
      updatedAt: 1,
    };

    const createPending = vi.fn(async () => createdRecord);
    const queuePrepare = vi.fn();
    let settleApproval: ((value: TransactionMeta) => void) | null = null;
    const createApproval = vi.fn(() => ({
      settled: new Promise<TransactionMeta>((resolve) => {
        settleApproval = resolve;
      }),
    }));

    const executor = new TransactionExecutor({
      view: {
        commitRecord: (record: TransactionRecord) => ({ next: toMeta(record, from) }),
      } as never,
      accountCodecs,
      networkSelection: {
        getSelectedChainRef: (namespace: string) => (namespace === "eip155" ? chainRef : null),
      } as never,
      supportedChains: {
        getChain: () => null,
      } as never,
      accounts: {
        getActiveAccountForNamespace: () => null,
        listOwnedForNamespace: () => [
          {
            accountKey,
            namespace: "eip155",
            canonicalAddress: from,
            displayAddress: from,
          },
        ],
      } as never,
      approvals: {
        create: createApproval,
      } as never,
      registry: {
        get: () => undefined,
      } as never,
      service: {
        createPending,
      } as never,
      prepare: {
        queuePrepare,
      } as never,
      tracking: {} as never,
      now: () => 1,
    });

    const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(REQUEST_ID);
    const handoff = await executor.beginTransactionApproval(
      {
        namespace: "eip155",
        payload: {
          from,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      REQUEST_CONTEXT,
    );
    randomUuidSpy.mockRestore();

    expect(handoff).toMatchObject({
      transactionId: REQUEST_ID,
      approvalId: REQUEST_ID,
      pendingMeta: { id: REQUEST_ID, status: "pending", chainRef, namespace: "eip155" },
    });
    expect(createPending).toHaveBeenCalledTimes(1);
    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            code: "transaction.adapter_missing",
          }),
        ],
      }),
    );
    expect(queuePrepare).toHaveBeenCalledWith(REQUEST_ID);
    expect(settleApproval).toBeTypeOf("function");
    expect(createApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        id: REQUEST_ID,
        createdAt: createdRecord.createdAt,
        origin: REQUEST_CONTEXT.origin,
      }),
      expect.objectContaining({
        origin: REQUEST_CONTEXT.origin,
        requestId: REQUEST_CONTEXT.requestId,
      }),
    );
  });

  it("uses namespace-specific active chain when request.chainRef is absent", async () => {
    const chainRef = "eip155:10";
    const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const accountKey = toAccountKeyFromAddress({ chainRef, address: from, accountCodecs });

    const createdRecord: TransactionRecord = {
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef,
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      status: "pending",
      request: {
        namespace: "eip155",
        chainRef,
        payload: {
          from,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
          chainId: "0xa",
        },
      },
      hash: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1,
      updatedAt: 1,
    };

    const createPending = vi.fn(async () => createdRecord);
    const queuePrepare = vi.fn();
    const approvalResult = toMeta(createdRecord, from);

    const executor = new TransactionExecutor({
      view: {
        commitRecord: (record: TransactionRecord) => ({ next: toMeta(record, from) }),
      } as never,
      accountCodecs: createAccountCodecRegistry([eip155Codec]),
      networkSelection: {
        getSelectedChainRef: (namespace: string) => (namespace === "eip155" ? chainRef : null),
      } as never,
      supportedChains: {
        getChain: () => null,
      } as never,
      accounts: {
        getActiveAccountForNamespace: () => null,
        listOwnedForNamespace: () => [
          {
            accountKey,
            namespace: "eip155",
            canonicalAddress: from,
            displayAddress: from,
          },
        ],
      } as never,
      approvals: {
        create: () => ({ settled: Promise.resolve(approvalResult) }),
      } as never,
      registry: {
        get: () => undefined,
      } as never,
      service: {
        createPending,
      } as never,
      prepare: {
        queuePrepare,
      } as never,
      tracking: {} as never,
      now: () => 1,
    });

    const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(REQUEST_ID);
    const handoff = await executor.beginTransactionApproval(
      {
        namespace: "eip155",
        payload: {
          from,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      REQUEST_CONTEXT,
    );
    randomUuidSpy.mockRestore();
    const result = await handoff.waitForApprovalDecision();

    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        chainRef,
        namespace: "eip155",
      }),
    );
    expect(queuePrepare).toHaveBeenCalledWith(REQUEST_ID);
    expect(result).toMatchObject({ chainRef, namespace: "eip155" });
  });

  it("delegates chain-specific request derivation to the namespace adapter before persistence", async () => {
    const chainRef = "eip155:10";
    const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const accountKey = toAccountKeyFromAddress({ chainRef, address: from, accountCodecs });

    const createdRecord: TransactionRecord = {
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef,
      origin: "https://dapp.example",
      fromAccountKey: accountKey,
      status: "pending",
      request: {
        namespace: "eip155",
        chainRef,
        payload: {
          from,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
          chainId: "0xa",
        },
      },
      hash: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1,
      updatedAt: 1,
    };

    const deriveRequestForChain = vi.fn((request, resolvedChainRef) => ({
      ...request,
      chainRef: resolvedChainRef,
      payload: {
        ...(request.payload as Record<string, unknown>),
        chainId: "0xa",
      },
    }));
    const createPending = vi.fn(async () => createdRecord);
    const queuePrepare = vi.fn();
    const approvalResult = toMeta(createdRecord, from);

    const executor = new TransactionExecutor({
      view: {
        commitRecord: (record: TransactionRecord) => ({ next: toMeta(record, from) }),
      } as never,
      accountCodecs: createAccountCodecRegistry([eip155Codec]),
      networkSelection: {
        getSelectedChainRef: (namespace: string) => (namespace === "eip155" ? chainRef : null),
      } as never,
      supportedChains: {
        getChain: () => null,
      } as never,
      accounts: {
        getActiveAccountForNamespace: () => null,
        listOwnedForNamespace: () => [
          {
            accountKey,
            namespace: "eip155",
            canonicalAddress: from,
            displayAddress: from,
          },
        ],
      } as never,
      approvals: {
        create: () => ({ settled: Promise.resolve(approvalResult) }),
      } as never,
      registry: {
        get: () => ({
          deriveRequestForChain,
          receiptTracking: createReceiptTrackingStub(),
        }),
      } as never,
      service: {
        createPending,
      } as never,
      prepare: {
        queuePrepare,
      } as never,
      tracking: {} as never,
      now: () => 1,
    });

    const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(REQUEST_ID);
    const handoff = await executor.beginTransactionApproval(
      {
        namespace: "eip155",
        payload: {
          from,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      REQUEST_CONTEXT,
    );
    randomUuidSpy.mockRestore();
    await handoff.waitForApprovalDecision();

    expect(deriveRequestForChain).toHaveBeenCalledWith(
      {
        namespace: "eip155",
        payload: {
          from,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      chainRef,
    );
    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        chainRef,
        request: {
          namespace: "eip155",
          chainRef,
          payload: expect.objectContaining({
            chainId: "0xa",
          }),
        },
      }),
    );
  });

  it("fails with a stable adapter-missing error when execution reaches a namespace without a transaction adapter", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const chainRef = "eip155:10";
    const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const accountKey = toAccountKeyFromAddress({ chainRef, address: from, accountCodecs });
    const approvedRecord: TransactionRecord = {
      id,
      namespace: "eip155",
      chainRef,
      origin: REQUEST_CONTEXT.origin,
      fromAccountKey: accountKey,
      status: "approved",
      request: {
        namespace: "eip155",
        chainRef,
        payload: {
          from,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      prepared: null,
      hash: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const failedRecord: TransactionRecord = {
      ...approvedRecord,
      status: "failed",
      updatedAt: 2,
      error: {
        name: "TransactionAdapterMissingError",
        message: "No transaction adapter registered for namespace eip155",
      },
    };

    const transition = vi.fn(async () => failedRecord);
    const commitRecord = vi.fn((record: TransactionRecord) => {
      if (record.status === "failed") {
        return {
          previous: toMeta(approvedRecord, from),
          next: {
            ...toMeta(failedRecord, from),
            error: failedRecord.error ?? null,
          },
        };
      }

      return { next: toMeta(record, from) };
    });

    const executor = new TransactionExecutor({
      view: {
        getOrLoad: async () => toMeta(approvedRecord, from),
        commitRecord,
      } as never,
      accountCodecs,
      networkSelection: {
        getSelectedChainRef: () => chainRef,
      } as never,
      supportedChains: {
        getChain: () => null,
      } as never,
      accounts: {
        getActiveAccountForNamespace: () => null,
        listOwnedForNamespace: () => [],
      } as never,
      approvals: {
        create: vi.fn(),
      } as never,
      registry: {
        get: () => undefined,
      } as never,
      service: {
        get: vi.fn(async () => approvedRecord),
        transition,
      } as never,
      prepare: {} as never,
      tracking: {
        stop: vi.fn(),
        handleTransition: vi.fn(),
      } as never,
      now: () => 1,
    });

    await executor.processTransaction(id);

    expect(transition).toHaveBeenCalledWith({
      id,
      fromStatus: "approved",
      toStatus: "failed",
      patch: {
        error: {
          name: "TransactionAdapterMissingError",
          message: "No transaction adapter registered for namespace eip155",
        },
        userRejected: false,
      },
    });
  });

  it("marks signer-stage user rejection as userRejected before broadcast", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const chainRef = "eip155:10";
    const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const accountKey = toAccountKeyFromAddress({ chainRef, address: from, accountCodecs });
    const signedRecord: TransactionRecord = {
      id,
      namespace: "eip155",
      chainRef,
      origin: REQUEST_CONTEXT.origin,
      fromAccountKey: accountKey,
      status: "signed",
      request: {
        namespace: "eip155",
        chainRef,
        payload: {
          from,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      prepared: {},
      hash: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const failedRecord: TransactionRecord = {
      ...signedRecord,
      status: "failed",
      userRejected: true,
      updatedAt: 2,
      error: {
        name: "TransactionRejectedError",
        message: "User rejected transaction",
        code: 4001,
      },
    };

    const transition = vi.fn(async () => failedRecord);
    const commitRecord = vi.fn((record: TransactionRecord) => {
      if (record.status === "failed") {
        return {
          previous: toMeta(signedRecord, from),
          next: {
            ...toMeta(failedRecord, from),
            error: failedRecord.error ?? null,
          },
        };
      }

      return { next: toMeta(record, from) };
    });

    const executor = new TransactionExecutor({
      view: {
        peek: () => undefined,
        getOrLoad: async () => null,
        commitRecord,
      } as never,
      accountCodecs,
      networkSelection: {
        getSelectedChainRef: () => chainRef,
      } as never,
      supportedChains: {
        getChain: () => null,
      } as never,
      accounts: {
        getActiveAccountForNamespace: () => null,
        listOwnedForNamespace: () => [],
      } as never,
      approvals: {
        create: vi.fn(),
      } as never,
      registry: {
        get: () => undefined,
      } as never,
      service: {
        get: vi.fn(async () => signedRecord),
        transition,
      } as never,
      prepare: {} as never,
      tracking: {
        stop: vi.fn(),
        handleTransition: vi.fn(),
      } as never,
      now: () => 1,
    });

    const rejectionError = Object.assign(new Error("User rejected transaction"), { code: 4001 });
    await executor.rejectTransaction(id, rejectionError);

    expect(transition).toHaveBeenCalledWith({
      id,
      fromStatus: "signed",
      toStatus: "failed",
      patch: {
        error: {
          name: "Error",
          message: "User rejected transaction",
          code: 4001,
        },
        userRejected: true,
      },
    });
  });
});
