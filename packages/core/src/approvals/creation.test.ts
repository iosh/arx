import { describe, expect, it } from "vitest";
import {
  type ApprovalController,
  type ApprovalCreateParams,
  type ApprovalHandle,
  type ApprovalKind,
  ApprovalKinds,
  type ApprovalRequester,
} from "../controllers/approval/types.js";
import type { RequestContext } from "../rpc/requestContext.js";
import { requestApproval } from "./creation.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REQUEST_CONTEXT: RequestContext = {
  transport: "provider",
  origin: "https://dapp.example",
  portId: "port-1",
  sessionId: "11111111-1111-4111-8111-111111111111",
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
    create: <K extends ApprovalKind>(
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
  } satisfies Pick<ApprovalController, "create"> & { calls: ApprovalCreateCall[] };
};

describe("requestApproval", () => {
  it("derives approval record fields from requestContext and request payload", () => {
    const approvals = createApprovals();

    const handle = requestApproval(
      {
        approvals,
        now: () => 123,
      },
      {
        kind: ApprovalKinds.RequestAccounts,
        requestContext: REQUEST_CONTEXT,
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
        origin: REQUEST_CONTEXT.origin,
        namespace: "eip155",
        chainRef: "eip155:1",
        createdAt: 123,
        request: {
          chainRef: "eip155:1",
          suggestedAccounts: ["0xabc"],
        },
      }),
      requester: {
        transport: REQUEST_CONTEXT.transport,
        origin: REQUEST_CONTEXT.origin,
        portId: REQUEST_CONTEXT.portId,
        sessionId: REQUEST_CONTEXT.sessionId,
        requestId: REQUEST_CONTEXT.requestId,
      },
    });
  });

  it("preserves explicit approvalId and createdAt for transaction-backed approvals", () => {
    const approvals = createApprovals();

    const handle = requestApproval(
      {
        approvals,
        now: () => 123,
      },
      {
        kind: ApprovalKinds.SendTransaction,
        requestContext: REQUEST_CONTEXT,
        approvalId: "22222222-2222-4222-8222-222222222222",
        createdAt: 456,
        request: {
          transactionId: "33333333-3333-4333-8333-333333333333",
          chainRef: "eip155:10",
          origin: REQUEST_CONTEXT.origin,
          chain: null,
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          request: {
            namespace: "eip155",
            chainRef: "eip155:10",
            payload: {
              to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              value: "0x0",
            },
          },
          warnings: [],
          issues: [],
        },
      },
    );

    expect(handle.approvalId).toBe("22222222-2222-4222-8222-222222222222");
    expect(approvals.calls).toHaveLength(1);
    expect(approvals.calls[0]).toEqual({
      request: expect.objectContaining({
        approvalId: "22222222-2222-4222-8222-222222222222",
        createdAt: 456,
        namespace: "eip155",
        chainRef: "eip155:10",
      }),
      requester: {
        transport: REQUEST_CONTEXT.transport,
        origin: REQUEST_CONTEXT.origin,
        portId: REQUEST_CONTEXT.portId,
        sessionId: REQUEST_CONTEXT.sessionId,
        requestId: REQUEST_CONTEXT.requestId,
      },
    });
  });

  it("rejects transaction approval requests whose payload origin mismatches requestContext", () => {
    const approvals = createApprovals();

    expect(() =>
      requestApproval(
        {
          approvals,
          now: () => 123,
        },
        {
          kind: ApprovalKinds.SendTransaction,
          requestContext: REQUEST_CONTEXT,
          request: {
            transactionId: "33333333-3333-4333-8333-333333333333",
            chainRef: "eip155:1",
            origin: "https://other.example",
            chain: null,
            from: null,
            request: {
              namespace: "eip155",
              chainRef: "eip155:1",
              payload: {},
            },
            warnings: [],
            issues: [],
          },
        },
      ),
    ).toThrow(/origin/i);
    expect(approvals.calls).toHaveLength(0);
  });
});
