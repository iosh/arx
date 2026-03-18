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
  it("can create a transaction approval without waiting for settlement", async () => {
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

    const executor = new TransactionExecutor({
      view: {
        commitRecord: (record: TransactionRecord) => ({ next: toMeta(record, from) }),
      } as never,
      accountCodecs,
      networkPreferences: {
        getActiveChainRef: (namespace: string) => (namespace === "eip155" ? chainRef : null),
      } as never,
      chainDefinitions: {
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
        create: () => ({
          settled: new Promise<TransactionMeta>((resolve) => {
            settleApproval = resolve;
          }),
        }),
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

    const result = await executor.createTransactionApproval(
      "https://dapp.example",
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
      { id: REQUEST_ID },
    );

    expect(result).toMatchObject({ id: REQUEST_ID, status: "pending", chainRef, namespace: "eip155" });
    expect(createPending).toHaveBeenCalledTimes(1);
    expect(queuePrepare).toHaveBeenCalledWith(REQUEST_ID);
    expect(settleApproval).toBeTypeOf("function");
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
      networkPreferences: {
        getActiveChainRef: (namespace: string) => (namespace === "eip155" ? chainRef : null),
      } as never,
      chainDefinitions: {
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

    const result = await executor.requestTransactionApproval(
      "https://dapp.example",
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
      { id: REQUEST_ID },
    );

    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        chainRef,
        namespace: "eip155",
      }),
    );
    expect(queuePrepare).toHaveBeenCalledWith(REQUEST_ID);
    expect(result).toMatchObject({ chainRef, namespace: "eip155" });
  });

  it("delegates request normalization to the namespace adapter before persistence", async () => {
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

    const normalizeRequest = vi.fn((request, resolvedChainRef) => ({
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
      networkPreferences: {
        getActiveChainRef: (namespace: string) => (namespace === "eip155" ? chainRef : null),
      } as never,
      chainDefinitions: {
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
          normalizeRequest,
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

    await executor.requestTransactionApproval(
      "https://dapp.example",
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
      { id: REQUEST_ID },
    );

    expect(normalizeRequest).toHaveBeenCalledWith(
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
});
