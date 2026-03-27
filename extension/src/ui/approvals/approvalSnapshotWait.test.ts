import type { ApprovalSummary, UiSnapshot } from "@arx/core/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitForAnyApprovalInSnapshot, waitForApprovalInSnapshot } from "./approvalSnapshotWait";

const { mockWaitForSnapshot } = vi.hoisted(() => ({
  mockWaitForSnapshot: vi.fn(),
}));

vi.mock("@/ui/lib/uiBridgeClient", () => ({
  uiClient: {
    waitForSnapshot: mockWaitForSnapshot,
  },
}));

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

function createSnapshot(opts?: { approvals?: ApprovalSummary[]; isUnlocked?: boolean }): UiSnapshot {
  return {
    approvals: opts?.approvals ?? [createApproval()],
    session: { isUnlocked: opts?.isUnlocked ?? true },
    vault: { initialized: true },
  } as UiSnapshot;
}

describe("approvalSnapshotWait", () => {
  beforeEach(() => {
    mockWaitForSnapshot.mockReset();
  });

  it("allows requested approval waits to resolve from a locked snapshot by default", async () => {
    const lockedSnapshot = createSnapshot({ isUnlocked: false });

    mockWaitForSnapshot.mockImplementation(async (opts: { predicate: (snapshot: UiSnapshot) => boolean }) => {
      expect(opts.predicate(lockedSnapshot)).toBe(true);
      return lockedSnapshot;
    });

    await expect(waitForApprovalInSnapshot("approval-1")).resolves.toMatchObject({ id: "approval-1" });
  });

  it("can require an unlocked snapshot for requested approval waits", async () => {
    const lockedSnapshot = createSnapshot({ isUnlocked: false });
    const unlockedSnapshot = createSnapshot({ isUnlocked: true });

    mockWaitForSnapshot.mockImplementation(async (opts: { predicate: (snapshot: UiSnapshot) => boolean }) => {
      expect(opts.predicate(lockedSnapshot)).toBe(false);
      expect(opts.predicate(unlockedSnapshot)).toBe(true);
      return unlockedSnapshot;
    });

    await expect(waitForApprovalInSnapshot("approval-1", { requireUnlocked: true })).resolves.toMatchObject({
      id: "approval-1",
    });
  });

  it("waits for any approval only while the session is unlocked", async () => {
    const lockedSnapshot = createSnapshot({ isUnlocked: false });
    const unlockedSnapshot = createSnapshot({ isUnlocked: true });

    mockWaitForSnapshot.mockImplementation(async (opts: { predicate: (snapshot: UiSnapshot) => boolean }) => {
      expect(opts.predicate(lockedSnapshot)).toBe(false);
      expect(opts.predicate(unlockedSnapshot)).toBe(true);
      return unlockedSnapshot;
    });

    await expect(waitForAnyApprovalInSnapshot()).resolves.toMatchObject({ approvals: [{ id: "approval-1" }] });
  });
});
