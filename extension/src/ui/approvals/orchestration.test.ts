import type { ApprovalSummary, UiSnapshot } from "@arx/core/ui";
import { describe, expect, it } from "vitest";
import type { UiEntryMetadata } from "@/lib/uiEntryMetadata";
import { getApprovalAttentionAction, getCurrentApprovalRouteId } from "./orchestration";

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

function createSnapshot(approvals: ApprovalSummary[], isUnlocked = true): UiSnapshot {
  return {
    approvals,
    session: { isUnlocked },
    vault: { initialized: true },
  } as UiSnapshot;
}

const createEntry = (overrides?: Partial<UiEntryMetadata>): UiEntryMetadata => ({
  environment: overrides?.environment ?? "notification",
  reason: overrides?.reason ?? "approval_created",
  context: overrides?.context ?? {
    approvalId: null,
    origin: null,
    method: null,
    chainRef: null,
    namespace: null,
  },
});

describe("getCurrentApprovalRouteId", () => {
  it("extracts the approval id from approval detail routes", () => {
    expect(getCurrentApprovalRouteId("/approve/sign-message/approval-1")).toBe("approval-1");
    expect(getCurrentApprovalRouteId("/approvals")).toBeNull();
  });
});

describe("getApprovalAttentionAction", () => {
  it("closes the popup once an unlocked approval queue drains", () => {
    expect(
      getApprovalAttentionAction({
        snapshot: createSnapshot([]),
        isLoading: false,
        entry: createEntry({ reason: "unlock_required" }),
        pathname: "/approve/sign-message/approval-1",
        requestedApprovalId: null,
        hadApprovalsSinceUnlock: true,
      }),
    ).toEqual({
      action: { type: "close" },
      nextHadApprovalsSinceUnlock: true,
    });
  });

  it("waits for a specifically requested approval before auto-routing", () => {
    expect(
      getApprovalAttentionAction({
        snapshot: createSnapshot([]),
        isLoading: false,
        entry: createEntry({ reason: "approval_created" }),
        pathname: "/",
        requestedApprovalId: "approval-2",
        hadApprovalsSinceUnlock: false,
      }),
    ).toEqual({
      action: { type: "waitForRequestedApproval" },
      nextHadApprovalsSinceUnlock: false,
    });
  });

  it("keeps the current route when the user is already on a live approval", () => {
    expect(
      getApprovalAttentionAction({
        snapshot: createSnapshot([createApproval()]),
        isLoading: false,
        entry: createEntry({ reason: "approval_created" }),
        pathname: "/approve/sign-message/approval-1",
        requestedApprovalId: null,
        hadApprovalsSinceUnlock: false,
      }),
    ).toEqual({
      action: { type: "noop" },
      nextHadApprovalsSinceUnlock: true,
    });
  });

  it("prefers the requested approval route when that id is now pending", () => {
    expect(
      getApprovalAttentionAction({
        snapshot: createSnapshot([
          createApproval({ id: "approval-1" }),
          createApproval({ id: "approval-2", type: "switchChain", payload: { chainRef: "eip155:10" } }),
        ]),
        isLoading: false,
        entry: createEntry({ reason: "approval_created" }),
        pathname: "/",
        requestedApprovalId: "approval-2",
        hadApprovalsSinceUnlock: false,
      }),
    ).toEqual({
      action: { type: "navigate", to: "/approve/switch-chain/approval-2" },
      nextHadApprovalsSinceUnlock: true,
    });
  });

  it("falls back to the head approval route when no requested id matches", () => {
    expect(
      getApprovalAttentionAction({
        snapshot: createSnapshot([
          createApproval({ id: "approval-1", type: "switchChain", payload: { chainRef: "eip155:1" } }),
          createApproval({ id: "approval-2" }),
        ]),
        isLoading: false,
        entry: createEntry({ reason: "approval_created" }),
        pathname: "/",
        requestedApprovalId: "missing",
        hadApprovalsSinceUnlock: false,
      }),
    ).toEqual({
      action: { type: "navigate", to: "/approve/switch-chain/approval-1" },
      nextHadApprovalsSinceUnlock: true,
    });
  });

  it("does not auto-orchestrate manual notification entries", () => {
    expect(
      getApprovalAttentionAction({
        snapshot: createSnapshot([]),
        isLoading: false,
        entry: createEntry({ reason: "manual_open" }),
        pathname: "/approvals",
        requestedApprovalId: null,
        hadApprovalsSinceUnlock: false,
      }),
    ).toEqual({
      action: { type: "noop" },
      nextHadApprovalsSinceUnlock: false,
    });
  });

  it("redirects reused manual-open notifications back to the approvals list", () => {
    expect(
      getApprovalAttentionAction({
        snapshot: createSnapshot([createApproval()]),
        isLoading: false,
        entry: createEntry({ reason: "manual_open" }),
        pathname: "/approve/sign-message/approval-1",
        requestedApprovalId: null,
        hadApprovalsSinceUnlock: true,
      }),
    ).toEqual({
      action: { type: "navigate", to: "/approvals" },
      nextHadApprovalsSinceUnlock: false,
    });
  });
});
