import type { ApprovalDetail } from "@arx/core/ui";
import { describe, expect, it } from "vitest";
import { readApprovalDetailForRoute } from "./detailRoute";

const INITIAL_DETAIL = {
  approvalId: "approval-1",
  kind: "signMessage",
  source: "provider",
  origin: "https://example.test",
  namespace: "eip155",
  chainRef: "eip155:1",
  createdAt: 1_000,
  actions: {
    canApprove: true,
    canReject: true,
  },
  request: {
    from: "0x1234",
    message: "hello",
  },
  review: null,
} satisfies ApprovalDetail;

describe("readApprovalDetailForRoute", () => {
  it("keeps the loader detail until the live query resolves", () => {
    expect(
      readApprovalDetailForRoute({
        initialDetail: INITIAL_DETAIL,
        currentDetail: undefined,
      }),
    ).toEqual(INITIAL_DETAIL);
  });

  it("switches to the refreshed detail once it is available", () => {
    const refreshed = {
      ...INITIAL_DETAIL,
      origin: "https://refreshed.test",
    } satisfies ApprovalDetail;

    expect(
      readApprovalDetailForRoute({
        initialDetail: INITIAL_DETAIL,
        currentDetail: refreshed,
      }),
    ).toEqual(refreshed);
  });

  it("returns null when the live query confirms that the approval is gone", () => {
    expect(
      readApprovalDetailForRoute({
        initialDetail: INITIAL_DETAIL,
        currentDetail: null,
      }),
    ).toBeNull();
  });
});
