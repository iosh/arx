import { describe, expect, it, vi } from "vitest";
import {
  APPROVAL_ID,
  APPROVAL_REQUESTER,
  accountCodecs,
  createAccountControllerStub,
  createNamespacesStub,
  createPrepareStub,
  createProposalRuntime,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
  REQUEST_ID,
} from "../__fixtures__/transactionServices.js";
import type { TransactionIntent } from "../intent/index.js";
import { TransactionProposalBeginService } from "./TransactionProposalBeginService.js";

const createBeginService = (params?: {
  chainRef?: string;
  from?: string;
  proposalRuntime?: ReturnType<typeof createProposalRuntime>;
  namespaces?: ReturnType<typeof createNamespacesStub>;
  approvals?: {
    createPending: (...args: never[]) => unknown;
  };
  prepare?: ReturnType<typeof createPrepareStub>;
}) => {
  const chainRef = params?.chainRef ?? DEFAULT_CHAIN_REF;
  const from = params?.from ?? DEFAULT_FROM;
  const proposalRuntime = params?.proposalRuntime ?? createProposalRuntime();
  const namespaces = params?.namespaces ?? createNamespacesStub();
  const prepare = params?.prepare ?? createPrepareStub();
  const createPendingApproval = params?.approvals?.createPending ?? vi.fn();

  return new TransactionProposalBeginService({
    proposalRuntime,
    accountCodecs,
    accounts: createAccountControllerStub({ chainRef, from }),
    approvals: { create: vi.fn() as never, createPending: createPendingApproval as never },
    namespaces: namespaces as never,
    prepare: prepare as never,
    now: () => 1,
  });
};

describe("TransactionProposalBeginService", () => {
  it("creates a proposal, attaches approval, and queues prepare", async () => {
    const chainRef = DEFAULT_CHAIN_REF;
    const proposalRuntime = createProposalRuntime();
    const queue = vi.fn();
    const createPendingApproval = vi.fn();
    const service = createBeginService({
      proposalRuntime,
      approvals: { createPending: createPendingApproval as never },
      prepare: createPrepareStub({ queue }),
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);

    const approvalRef = await service.beginTransactionApproval(
      {
        namespace: "eip155",
        chainRef,
        account: {
          accountKey: accountCodecs.toAccountKeyFromAddress({
            chainRef,
            address: DEFAULT_FROM,
          }),
          accountAddress: DEFAULT_FROM,
          requestedAddress: DEFAULT_FROM,
        },
        request: {
          namespace: "eip155",
          chainRef,
          payload: {
            from: DEFAULT_FROM,
            to: DEFAULT_TO,
            value: "0x0",
            data: "0x",
          },
        },
      } satisfies TransactionIntent,
      APPROVAL_REQUESTER,
      {},
    );

    randomUuidSpy.mockRestore();

    expect(approvalRef).toEqual({
      transactionId: REQUEST_ID,
      approvalId: APPROVAL_ID,
    });
    expect(createPendingApproval).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledWith(REQUEST_ID);
  });

  it("uses an externally allocated approval identity when beginning an approval", async () => {
    const chainRef = DEFAULT_CHAIN_REF;
    const proposalRuntime = createProposalRuntime();
    const createPendingApproval = vi.fn();
    const service = createBeginService({
      proposalRuntime,
      approvals: { createPending: createPendingApproval as never },
    });

    const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValueOnce(REQUEST_ID);

    const approvalRef = await service.beginTransactionApproval(
      {
        namespace: "eip155",
        chainRef,
        account: {
          accountKey: accountCodecs.toAccountKeyFromAddress({
            chainRef,
            address: DEFAULT_FROM,
          }),
          accountAddress: DEFAULT_FROM,
        },
        request: {
          namespace: "eip155",
          chainRef,
          payload: {
            from: DEFAULT_FROM,
            to: DEFAULT_TO,
            value: "0x0",
            data: "0x",
          },
        },
      } satisfies TransactionIntent,
      APPROVAL_REQUESTER,
      {
        approvalIdentity: {
          approvalId: APPROVAL_ID,
          createdAt: 42,
        },
      },
    );

    randomUuidSpy.mockRestore();

    expect(approvalRef).toEqual({
      transactionId: REQUEST_ID,
      approvalId: APPROVAL_ID,
    });
    expect(createPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: APPROVAL_ID,
        createdAt: 42,
      }),
      APPROVAL_REQUESTER,
    );
    expect(proposalRuntime.getProposalStateSnapshot(REQUEST_ID)).toMatchObject({
      id: REQUEST_ID,
      approvalId: APPROVAL_ID,
      createdAt: 42,
    });
  });

  it("rejects approval requests from a different origin than the proposal", () => {
    const createPendingApproval = vi.fn();
    const service = createBeginService({
      approvals: { createPending: createPendingApproval as never },
    });

    const proposalMeta = service.createProposal(
      {
        namespace: "eip155",
        chainRef: DEFAULT_CHAIN_REF,
        account: {
          accountKey: accountCodecs.toAccountKeyFromAddress({
            chainRef: DEFAULT_CHAIN_REF,
            address: DEFAULT_FROM,
          }),
          accountAddress: DEFAULT_FROM,
        },
        request: {
          namespace: "eip155",
          chainRef: DEFAULT_CHAIN_REF,
          payload: {
            from: DEFAULT_FROM,
            to: DEFAULT_TO,
            value: "0x0",
            data: "0x",
          },
        },
      } satisfies TransactionIntent,
      { origin: APPROVAL_REQUESTER.origin },
    );

    expect(() =>
      service.requestApproval(proposalMeta, {
        ...APPROVAL_REQUESTER,
        origin: "https://other.example",
      }),
    ).toThrow(/origin/i);
    expect(createPendingApproval).not.toHaveBeenCalled();
  });
});
