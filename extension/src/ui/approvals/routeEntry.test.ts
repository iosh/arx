import type { ApprovalSummary, UiSnapshot } from "@arx/core/ui";
import { describe, expect, it } from "vitest";
import { ROUTES } from "@/ui/lib/routes";
import { getApprovalRouteEntry } from "./routeEntry";

function createApproval(overrides?: Partial<ApprovalSummary>): ApprovalSummary {
  return {
    id: "approval-1",
    origin: "https://example.test",
    namespace: "eip155",
    chainRef: "eip155:1",
    createdAt: 1_000,
    type: "signMessage",
    payload: {
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      message: "hello",
    },
    ...overrides,
  } as ApprovalSummary;
}

function createSnapshot(approvals: ApprovalSummary[]): UiSnapshot {
  return {
    approvals,
  } as UiSnapshot;
}

describe("getApprovalRouteEntry", () => {
  it("returns loading while snapshot is pending", () => {
    expect(
      getApprovalRouteEntry({
        snapshot: undefined,
        isLoading: true,
        approvalId: "approval-1",
        expectedType: "signMessage",
      }),
    ).toEqual({ status: "loading" });
  });

  it("redirects to approvals list when the requested id is missing", () => {
    expect(
      getApprovalRouteEntry({
        snapshot: createSnapshot([]),
        isLoading: false,
        approvalId: "approval-1",
        expectedType: "signMessage",
      }),
    ).toEqual({
      status: "redirect",
      to: ROUTES.APPROVALS,
      replace: true,
    });
  });

  it("redirects to the canonical approval route when the type does not match", () => {
    expect(
      getApprovalRouteEntry({
        snapshot: createSnapshot([createApproval({ type: "switchChain", payload: { chainRef: "eip155:1" } })]),
        isLoading: false,
        approvalId: "approval-1",
        expectedType: "signMessage",
      }),
    ).toEqual({
      status: "redirect",
      to: "/approve/switch-chain/approval-1",
      replace: true,
    });
  });

  it("returns a typed approval when the route matches", () => {
    expect(
      getApprovalRouteEntry({
        snapshot: createSnapshot([createApproval()]),
        isLoading: false,
        approvalId: "approval-1",
        expectedType: "signMessage",
      }),
    ).toEqual({
      status: "ready",
      approval: createApproval(),
    });
  });
});
