import { describe, expect, it, vi } from "vitest";
import {
  APPROVAL_ID,
  accountCodecs,
  createAccountControllerStub,
  createNamespacesStub,
  createPrepareStub,
  createProposalRuntime,
  DEFAULT_CHAIN_REF,
  DEFAULT_FROM,
  DEFAULT_TO,
  REQUEST_CONTEXT,
  REQUEST_ID,
} from "./__fixtures__/transactionServices.js";
import { TransactionProposalBeginService } from "./TransactionProposalBeginService.js";

const createBeginService = (params?: {
  chainRef?: string;
  from?: string;
  proposalRuntime?: ReturnType<typeof createProposalRuntime>;
  namespaces?: ReturnType<typeof createNamespacesStub>;
  approvals?: {
    create: (...args: never[]) => unknown;
  };
  prepare?: ReturnType<typeof createPrepareStub>;
}) => {
  const chainRef = params?.chainRef ?? DEFAULT_CHAIN_REF;
  const from = params?.from ?? DEFAULT_FROM;
  const proposalRuntime = params?.proposalRuntime ?? createProposalRuntime();
  const namespaces = params?.namespaces ?? createNamespacesStub();
  const prepare = params?.prepare ?? createPrepareStub();
  const createApproval =
    params?.approvals?.create ??
    vi.fn(() => ({
      approvalId: APPROVAL_ID,
      settled: Promise.resolve(undefined),
    }));

  return new TransactionProposalBeginService({
    proposalRuntime,
    accountCodecs,
    accounts: createAccountControllerStub({ chainRef, from }),
    approvals: { create: createApproval as never },
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
    const createApproval = vi.fn(() => ({
      approvalId: APPROVAL_ID,
      settled: Promise.resolve(undefined),
    }));
    const service = createBeginService({
      proposalRuntime,
      approvals: { create: createApproval as never },
      prepare: createPrepareStub({ queue }),
    });

    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(REQUEST_ID)
      .mockReturnValueOnce(APPROVAL_ID);

    const handoff = await service.beginTransactionApproval(
      {
        namespace: "eip155",
        chainRef,
        payload: {
          from: DEFAULT_FROM,
          to: DEFAULT_TO,
          value: "0x0",
          data: "0x",
        },
      },
      REQUEST_CONTEXT,
      { from: DEFAULT_FROM },
    );

    randomUuidSpy.mockRestore();

    expect(handoff).toEqual({
      transactionId: REQUEST_ID,
      approvalId: APPROVAL_ID,
    });
    expect(createApproval).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledWith(REQUEST_ID);
  });
});
