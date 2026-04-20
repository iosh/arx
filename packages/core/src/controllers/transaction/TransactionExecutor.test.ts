import { ArxReasons, arxError } from "@arx/errors";
import { describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../../accounts/addressing/accountKey.js";
import { createAccountCodecRegistry, eip155Codec } from "../../accounts/addressing/codec.js";
import type { TransactionRecord } from "../../storage/records.js";
import { TransactionExecutor } from "./TransactionExecutor.js";
import type { TransactionMeta } from "./types.js";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const APPROVAL_ID = "22222222-2222-4222-8222-222222222222";
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
  it("begins a transaction approval with a linked but distinct approval id", async () => {
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
      approvalId: APPROVAL_ID,
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
        getActiveAccountForNamespace: () => ({
          accountKey,
          namespace: "eip155",
          canonicalAddress: from,
          displayAddress: from,
        }),
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
        get: () => ({
          validateRequest: () => undefined,
          receiptTracking: createReceiptTrackingStub(),
        }),
      } as never,
      service: {
        createPending,
      } as never,
      prepare: {
        queuePrepare,
      } as never,
      reviewSessions: {} as never,
      tracking: {} as never,
      now: () => 1,
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);
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
      approvalId: APPROVAL_ID,
      pendingMeta: { id: REQUEST_ID, status: "pending", chainRef, namespace: "eip155" },
    });
    expect(createPending).toHaveBeenCalledTimes(1);
    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: [],
        warnings: [],
      }),
    );
    expect(queuePrepare).toHaveBeenCalledWith(REQUEST_ID);
    expect(settleApproval).toBeTypeOf("function");
    expect(createApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: APPROVAL_ID,
        createdAt: createdRecord.createdAt,
        origin: REQUEST_CONTEXT.origin,
        subject: {
          kind: "transaction",
          transactionId: REQUEST_ID,
        },
        request: expect.objectContaining({
          chainRef,
        }),
      }),
      expect.objectContaining({
        origin: REQUEST_CONTEXT.origin,
        requestId: REQUEST_CONTEXT.requestId,
      }),
    );
  });

  it("attaches provider-scoped transaction approvals through the provider request handle", async () => {
    const chainRef = "eip155:10";
    const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const accountKey = toAccountKeyFromAddress({ chainRef, address: from, accountCodecs });

    const createdRecord: TransactionRecord = {
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef,
      origin: REQUEST_CONTEXT.origin,
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
    const createApproval = vi.fn(() => ({
      approvalId: APPROVAL_ID,
      settled: Promise.resolve(toMeta(createdRecord, from)),
    }));
    const attachBlockingApproval = vi.fn(
      <T>(
        createLinkedApproval: (reservation: { approvalId: string; createdAt: number }) => T,
        reservation?: Partial<{ approvalId: string; createdAt: number }>,
      ) =>
        createLinkedApproval({
          approvalId: reservation?.approvalId ?? "unexpected-approval-id",
          createdAt: reservation?.createdAt ?? 0,
        }),
    );

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
        getActiveAccountForNamespace: () => ({
          accountKey,
          namespace: "eip155",
          canonicalAddress: from,
          displayAddress: from,
        }),
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
        get: () => ({
          validateRequest: () => undefined,
          receiptTracking: createReceiptTrackingStub(),
        }),
      } as never,
      service: {
        createPending,
      } as never,
      prepare: {
        queuePrepare,
      } as never,
      reviewSessions: {} as never,
      tracking: {} as never,
      now: () => 1,
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);
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
      {
        providerRequestHandle: {
          id: REQUEST_CONTEXT.requestId,
          providerNamespace: "eip155",
          attachBlockingApproval,
          fulfill: () => true,
          reject: () => true,
          cancel: async () => true,
          getTerminalError: () => null,
        },
      },
    );
    randomUuidSpy.mockRestore();

    expect(handoff.approvalId).toBe(APPROVAL_ID);
    expect(attachBlockingApproval).toHaveBeenCalledTimes(1);
    expect(attachBlockingApproval).toHaveBeenCalledWith(expect.any(Function), {
      approvalId: APPROVAL_ID,
      createdAt: createdRecord.createdAt,
    });
    expect(createApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: APPROVAL_ID,
        createdAt: createdRecord.createdAt,
        origin: REQUEST_CONTEXT.origin,
        subject: {
          kind: "transaction",
          transactionId: REQUEST_ID,
        },
        request: expect.objectContaining({
          chainRef,
        }),
      }),
      expect.objectContaining({
        origin: REQUEST_CONTEXT.origin,
        requestId: REQUEST_CONTEXT.requestId,
      }),
    );
  });

  it("fails the pending transaction if provider scope is lost before approval attach completes", async () => {
    const chainRef = "eip155:10";
    const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const accountKey = toAccountKeyFromAddress({ chainRef, address: from, accountCodecs });

    const createdRecord: TransactionRecord = {
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef,
      origin: REQUEST_CONTEXT.origin,
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
    const failedRecord: TransactionRecord = {
      ...createdRecord,
      status: "failed",
      updatedAt: 2,
      error: {
        name: "ArxError",
        message: "Transport disconnected.",
      },
    };

    const transition = vi.fn(async () => failedRecord);
    const queuePrepare = vi.fn();
    const tracking = {
      stop: vi.fn(),
      handleTransition: vi.fn(),
    };
    const createApproval = vi.fn();
    const attachFailure = arxError({
      reason: ArxReasons.TransportDisconnected,
      message: "Transport disconnected.",
    });
    const commitRecord = vi.fn((record: TransactionRecord) => {
      if (record.status === "failed") {
        return {
          previous: toMeta(createdRecord, from),
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
        commitRecord,
      } as never,
      accountCodecs,
      networkSelection: {
        getSelectedChainRef: (namespace: string) => (namespace === "eip155" ? chainRef : null),
      } as never,
      supportedChains: {
        getChain: () => null,
      } as never,
      accounts: {
        getActiveAccountForNamespace: () => ({
          accountKey,
          namespace: "eip155",
          canonicalAddress: from,
          displayAddress: from,
        }),
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
        get: () => ({
          validateRequest: () => undefined,
          receiptTracking: createReceiptTrackingStub(),
        }),
      } as never,
      service: {
        createPending: vi.fn(async () => createdRecord),
        get: vi.fn(async () => createdRecord),
        transition,
      } as never,
      prepare: {
        queuePrepare,
      } as never,
      reviewSessions: {} as never,
      tracking: tracking as never,
      now: () => 1,
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);
    await expect(
      executor.beginTransactionApproval(
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
        {
          providerRequestHandle: {
            id: REQUEST_CONTEXT.requestId,
            providerNamespace: "eip155",
            attachBlockingApproval: () => {
              throw attachFailure;
            },
            fulfill: () => true,
            reject: () => true,
            cancel: async () => true,
            getTerminalError: () => attachFailure,
          },
        },
      ),
    ).rejects.toBe(attachFailure);
    randomUuidSpy.mockRestore();

    expect(createApproval).not.toHaveBeenCalled();
    expect(queuePrepare).not.toHaveBeenCalled();
    expect(transition).toHaveBeenCalledWith({
      id: REQUEST_ID,
      fromStatus: "pending",
      toStatus: "failed",
      patch: {
        error: expect.objectContaining({
          message: "Transport disconnected.",
        }),
        userRejected: false,
      },
    });
    expect(tracking.stop).toHaveBeenCalledWith(REQUEST_ID);
    expect(tracking.handleTransition).toHaveBeenCalledTimes(1);
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
        getActiveAccountForNamespace: () => ({
          accountKey,
          namespace: "eip155",
          canonicalAddress: from,
          displayAddress: from,
        }),
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
        create: () => ({ id: REQUEST_ID, settled: Promise.resolve(approvalResult) }),
      } as never,
      registry: {
        get: () => ({
          validateRequest: () => undefined,
          receiptTracking: createReceiptTrackingStub(),
        }),
      } as never,
      service: {
        createPending,
      } as never,
      prepare: {
        queuePrepare,
      } as never,
      reviewSessions: {} as never,
      tracking: {} as never,
      now: () => 1,
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);
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
        getActiveAccountForNamespace: () => ({
          accountKey,
          namespace: "eip155",
          canonicalAddress: from,
          displayAddress: from,
        }),
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
        create: () => ({ id: APPROVAL_ID, settled: Promise.resolve(approvalResult) }),
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
      reviewSessions: {} as never,
      tracking: {} as never,
      now: () => 1,
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);
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

  it("rejects before creating approval when no adapter is registered", async () => {
    const chainRef = "eip155:10";
    const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const accountKey = toAccountKeyFromAddress({ chainRef, address: from, accountCodecs });
    const createPending = vi.fn();
    const createApproval = vi.fn();

    const executor = new TransactionExecutor({
      view: {
        commitRecord: vi.fn(),
      } as never,
      accountCodecs,
      networkSelection: {
        getSelectedChainRef: () => chainRef,
      } as never,
      supportedChains: {
        getChain: () => null,
      } as never,
      accounts: {
        getActiveAccountForNamespace: () => ({
          accountKey,
          namespace: "eip155",
          canonicalAddress: from,
          displayAddress: from,
        }),
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
        queuePrepare: vi.fn(),
      } as never,
      reviewSessions: {} as never,
      tracking: {} as never,
      now: () => 1,
    });

    await expect(
      executor.beginTransactionApproval(
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
      ),
    ).rejects.toMatchObject({
      name: "TransactionAdapterMissingError",
    });

    expect(createPending).not.toHaveBeenCalled();
    expect(createApproval).not.toHaveBeenCalled();
  });

  it("rejects before creating approval when request validation finds invalid fee fields", async () => {
    const chainRef = "eip155:10";
    const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const accountKey = toAccountKeyFromAddress({ chainRef, address: from, accountCodecs });
    const createPending = vi.fn();
    const createApproval = vi.fn();

    const executor = new TransactionExecutor({
      view: {
        commitRecord: vi.fn(),
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
        get: () => ({
          validateRequest: () => {
            throw arxError({
              reason: ArxReasons.RpcInvalidParams,
              message: "Cannot mix legacy gasPrice with EIP-1559 fields.",
              data: { code: "transaction.prepare.fee_conflict" },
            });
          },
          receiptTracking: createReceiptTrackingStub(),
        }),
      } as never,
      service: {
        createPending,
      } as never,
      prepare: {
        queuePrepare: vi.fn(),
      } as never,
      reviewSessions: {} as never,
      tracking: {} as never,
      now: () => 1,
    });

    await expect(
      executor.beginTransactionApproval(
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
      ),
    ).rejects.toMatchObject({
      reason: ArxReasons.RpcInvalidParams,
      message: "Cannot mix legacy gasPrice with EIP-1559 fields.",
    });

    expect(createPending).not.toHaveBeenCalled();
    expect(createApproval).not.toHaveBeenCalled();
  });

  it("passes owner validation context into request validation before creating approval", async () => {
    const chainRef = "eip155:10";
    const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const accountKey = toAccountKeyFromAddress({ chainRef, address: from, accountCodecs });
    const createPending = vi.fn();
    const createApproval = vi.fn();
    const validateRequest = vi.fn(() => {
      throw arxError({
        reason: ArxReasons.RpcInvalidParams,
        message: "chainId does not match active chain.",
        data: { code: "transaction.prepare.chain_id_mismatch" },
      });
    });

    const executor = new TransactionExecutor({
      view: {
        commitRecord: vi.fn(),
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
        get: () => ({
          validateRequest,
          receiptTracking: createReceiptTrackingStub(),
        }),
      } as never,
      service: {
        createPending,
      } as never,
      prepare: {
        queuePrepare: vi.fn(),
      } as never,
      reviewSessions: {} as never,
      tracking: {} as never,
      now: () => 1,
    });

    await expect(
      executor.beginTransactionApproval(
        {
          namespace: "eip155",
          payload: {
            from,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
            chainId: "0x1",
          },
        },
        REQUEST_CONTEXT,
      ),
    ).rejects.toMatchObject({
      reason: ArxReasons.RpcInvalidParams,
      message: "chainId does not match active chain.",
    });

    expect(validateRequest).toHaveBeenCalledWith({
      namespace: "eip155",
      chainRef,
      origin: REQUEST_CONTEXT.origin,
      from,
      request: {
        namespace: "eip155",
        chainRef,
        payload: {
          from,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          chainId: "0x1",
        },
      },
    });
    expect(createPending).not.toHaveBeenCalled();
    expect(createApproval).not.toHaveBeenCalled();
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
      reviewSessions: {} as never,
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
      reviewSessions: {} as never,
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

  it("keeps retrying rejection until a concurrent status progression reaches a writable state", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const chainRef = "eip155:10";
    const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const accountKey = toAccountKeyFromAddress({ chainRef, address: from, accountCodecs });

    const pendingRecord: TransactionRecord = {
      id,
      namespace: "eip155",
      chainRef,
      origin: REQUEST_CONTEXT.origin,
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
    const approvedRecord: TransactionRecord = {
      ...pendingRecord,
      status: "approved",
      updatedAt: 2,
    };
    const signedRecord: TransactionRecord = {
      ...approvedRecord,
      status: "signed",
      prepared: {},
      updatedAt: 3,
    };
    const broadcastRecord: TransactionRecord = {
      ...signedRecord,
      status: "broadcast",
      hash: "0x1234",
      updatedAt: 4,
    };
    const failedRecord: TransactionRecord = {
      ...broadcastRecord,
      status: "failed",
      updatedAt: 5,
      error: {
        name: "Error",
        message: "Transport disconnected.",
      },
    };

    const tracking = {
      stop: vi.fn(),
      handleTransition: vi.fn(),
    };
    const transition = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(failedRecord);
    const get = vi
      .fn()
      .mockResolvedValueOnce(pendingRecord)
      .mockResolvedValueOnce(approvedRecord)
      .mockResolvedValueOnce(signedRecord)
      .mockResolvedValueOnce(broadcastRecord);
    const commitRecord = vi.fn((record: TransactionRecord) => {
      if (record.status === "failed") {
        return {
          previous: toMeta(broadcastRecord, from),
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
        get,
        transition,
      } as never,
      prepare: {} as never,
      reviewSessions: {} as never,
      tracking: tracking as never,
      now: () => 1,
    });

    await executor.rejectTransaction(id, new Error("Transport disconnected."));

    expect(transition.mock.calls).toEqual([
      [
        {
          id,
          fromStatus: "pending",
          toStatus: "failed",
          patch: {
            error: {
              name: "Error",
              message: "Transport disconnected.",
            },
            userRejected: false,
          },
        },
      ],
      [
        {
          id,
          fromStatus: "approved",
          toStatus: "failed",
          patch: {
            error: {
              name: "Error",
              message: "Transport disconnected.",
            },
            userRejected: false,
          },
        },
      ],
      [
        {
          id,
          fromStatus: "signed",
          toStatus: "failed",
          patch: {
            error: {
              name: "Error",
              message: "Transport disconnected.",
            },
            userRejected: false,
          },
        },
      ],
      [
        {
          id,
          fromStatus: "broadcast",
          toStatus: "failed",
          patch: {
            error: {
              name: "Error",
              message: "Transport disconnected.",
            },
            userRejected: false,
          },
        },
      ],
    ]);
    expect(tracking.stop).toHaveBeenCalledWith(id);
    expect(tracking.handleTransition).toHaveBeenCalledTimes(1);
  });
});
