import { describe, expect, it } from "vitest";
import { ApprovalKinds, type ApprovalRecord } from "../controllers/approval/types.js";
import { createApprovalFlowRegistry } from "./registry.js";
import type { ApprovalFlow, ApprovalFlowPresenterDeps } from "./types.js";

const presenterDeps: ApprovalFlowPresenterDeps = {
  accounts: {
    getActiveAccountForNamespace: () => null,
    listOwnedForNamespace: () => [],
  },
  chainViews: {
    getApprovalReviewChainView: ({ record }) => ({
      namespace: record.namespace,
      chainRef: record.chainRef,
    }),
    findAvailableChainView: () => null,
  },
  transactions: {
    getMeta: () => undefined,
  },
};

const createRecord = (): ApprovalRecord<typeof ApprovalKinds.RequestAccounts> => ({
  id: "approval-1",
  kind: ApprovalKinds.RequestAccounts,
  origin: "https://dapp.example",
  namespace: "eip155",
  chainRef: "eip155:1",
  createdAt: 1_000,
  request: {
    chainRef: "eip155:1",
    suggestedAccounts: ["0xabc"],
  },
  requester: {
    transport: "provider",
    origin: "https://dapp.example",
    portId: "port-1",
    sessionId: "session-1",
    requestId: "request-1",
  },
});

describe("createApprovalFlowRegistry", () => {
  it("falls back to unsupported when a flow is missing", () => {
    const registry = createApprovalFlowRegistry({ flows: [] });
    const record = createRecord();

    expect(registry.present(record, presenterDeps)).toEqual({
      id: record.id,
      origin: record.origin,
      namespace: record.namespace,
      chainRef: record.chainRef,
      createdAt: record.createdAt,
      type: "unsupported",
      payload: {
        rawType: record.kind,
        rawPayload: record.request,
      },
    });
  });

  it("falls back to unsupported when a presenter throws", () => {
    const brokenFlow: ApprovalFlow<typeof ApprovalKinds.RequestAccounts> = {
      kind: ApprovalKinds.RequestAccounts,
      parseDecision: () => ({ accountKeys: ["eip155:0000000000000000000000000000000000000000"] }),
      present: () => {
        throw new Error("broken presenter");
      },
      approve: async () => ["0xabc"],
    };

    const registry = createApprovalFlowRegistry({ flows: [brokenFlow] });
    const record = createRecord();

    expect(registry.present(record, presenterDeps)).toMatchObject({
      id: record.id,
      type: "unsupported",
      payload: {
        rawType: record.kind,
        rawPayload: record.request,
      },
    });
  });

  it("falls back to unsupported when a presenter returns an invalid summary", () => {
    const invalidFlow: ApprovalFlow<typeof ApprovalKinds.RequestAccounts> = {
      kind: ApprovalKinds.RequestAccounts,
      parseDecision: () => ({ accountKeys: ["eip155:0000000000000000000000000000000000000000"] }),
      present: () =>
        ({
          id: "approval-1",
          origin: "https://dapp.example",
          namespace: "eip155",
          chainRef: "eip155:1",
          createdAt: 1_000,
          type: "requestAccounts",
          payload: {
            selectableAccounts: [],
          },
        }) as never,
      approve: async () => ["0xabc"],
    };

    const registry = createApprovalFlowRegistry({ flows: [invalidFlow] });
    const record = createRecord();

    expect(registry.present(record, presenterDeps)).toMatchObject({
      id: record.id,
      type: "unsupported",
      payload: {
        rawType: record.kind,
        rawPayload: record.request,
      },
    });
  });
});
