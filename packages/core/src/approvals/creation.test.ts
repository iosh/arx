import { describe, expect, it } from "vitest";
import {
  type ApprovalCreateParams,
  type ApprovalHandle,
  ApprovalKinds,
  type ApprovalQueueKind,
  type ApprovalQueueService,
  type ApprovalRequester,
} from "../approvals/queue/types.js";
import { requestApproval } from "./creation.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REQUESTER: ApprovalRequester = {
  origin: "https://dapp.example",
  source: "provider",
  requestId: "rpc-1",
};

type ApprovalCreateCall = {
  request: ApprovalCreateParams;
  requester: ApprovalRequester;
};

const createApprovals = () => {
  const calls: ApprovalCreateCall[] = [];

  return {
    calls,
    create: <K extends ApprovalQueueKind>(
      request: ApprovalCreateParams<K>,
      requester: ApprovalRequester,
    ): ApprovalHandle<K> => {
      calls.push({
        request: request as ApprovalCreateParams,
        requester,
      });

      return {
        approvalId: request.approvalId,
        settled: new Promise<Awaited<ApprovalHandle<K>["settled"]>>(() => {}),
      };
    },
  } satisfies Pick<ApprovalQueueService, "create"> & { calls: ApprovalCreateCall[] };
};

describe("requestApproval", () => {
  it("derives approval record fields from requester and request payload", () => {
    const approvals = createApprovals();

    const handle = requestApproval(
      {
        approvals,
        now: () => 123,
      },
      {
        kind: ApprovalKinds.RequestAccounts,
        requester: REQUESTER,
        request: {
          chainRef: "eip155:1",
          suggestedAccounts: ["0xabc"],
        },
      },
    );

    expect(handle.approvalId).toMatch(UUID_PATTERN);
    expect(approvals.calls).toHaveLength(1);
    expect(approvals.calls[0]).toEqual({
      request: expect.objectContaining({
        approvalId: handle.approvalId,
        kind: ApprovalKinds.RequestAccounts,
        origin: REQUESTER.origin,
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 123,
        request: {
          chainRef: "eip155:1",
          suggestedAccounts: ["0xabc"],
        },
      }),
      requester: {
        origin: REQUESTER.origin,
        source: REQUESTER.source,
        requestId: REQUESTER.requestId,
      },
    });
  });

  it("preserves explicit approvalId and createdAt", () => {
    const approvals = createApprovals();

    const handle = requestApproval(
      {
        approvals,
        now: () => 123,
      },
      {
        kind: ApprovalKinds.SwitchChain,
        requester: REQUESTER,
        approvalId: "22222222-2222-4222-8222-222222222222",
        createdAt: 456,
        request: {
          chainRef: "eip155:10",
        },
      },
    );

    expect(handle.approvalId).toBe("22222222-2222-4222-8222-222222222222");
    expect(approvals.calls).toHaveLength(1);
    expect(approvals.calls[0]).toEqual({
      request: expect.objectContaining({
        approvalId: "22222222-2222-4222-8222-222222222222",
        kind: ApprovalKinds.SwitchChain,
        createdAt: 456,
        namespace: "eip155",
        chainRef: "eip155:10",
        request: {
          chainRef: "eip155:10",
        },
      }),
      requester: {
        origin: REQUESTER.origin,
        source: REQUESTER.source,
        requestId: REQUESTER.requestId,
      },
    });
  });
});
