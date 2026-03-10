import { describe, expect, it, vi } from "vitest";
import { toAccountIdFromAddress } from "../../accounts/addressing/accountId.js";
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
  it("uses namespace-specific active chain when request.chainRef is absent", async () => {
    const chainRef = "eip155:10";
    const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const accountId = toAccountIdFromAddress({ chainRef, address: from });

    const createdRecord: TransactionRecord = {
      id: REQUEST_ID,
      namespace: "eip155",
      chainRef,
      origin: "https://dapp.example",
      fromAccountId: accountId,
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
            accountId,
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
});
