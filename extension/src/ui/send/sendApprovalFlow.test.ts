import type { UiSnapshot } from "@arx/core/ui";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestSendApprovalAndNavigate,
  SEND_APPROVAL_NOT_READY_ERROR,
  waitForRequestedSendApproval,
} from "./sendApprovalFlow";

const { mockRequestSendTransactionApproval, mockWaitForUiSnapshotMatch } = vi.hoisted(() => ({
  mockRequestSendTransactionApproval: vi.fn(),
  mockWaitForUiSnapshotMatch: vi.fn(),
}));

vi.mock("@/ui/lib/uiBridgeClient", () => ({
  uiClient: {
    transactions: {
      requestSendTransactionApproval: mockRequestSendTransactionApproval,
    },
  },
}));

vi.mock("@/ui/lib/uiSnapshotQuery", () => ({
  waitForUiSnapshotMatch: mockWaitForUiSnapshotMatch,
}));

function createSnapshot(params?: { approvalId?: string; isUnlocked?: boolean }): UiSnapshot {
  return {
    approvals: params?.approvalId ? ([{ id: params.approvalId }] as UiSnapshot["approvals"]) : [],
    session: { isUnlocked: params?.isUnlocked ?? true },
    vault: { initialized: true },
  } as UiSnapshot;
}

describe("sendApprovalFlow", () => {
  beforeEach(() => {
    mockRequestSendTransactionApproval.mockReset();
    mockWaitForUiSnapshotMatch.mockReset();
  });

  it("waits for the requested send approval in an unlocked snapshot", async () => {
    const queryClient = new QueryClient();
    const lockedSnapshot = createSnapshot({ approvalId: "approval-1", isUnlocked: false });
    const wrongApprovalSnapshot = createSnapshot({ approvalId: "approval-2", isUnlocked: true });
    const readySnapshot = createSnapshot({ approvalId: "approval-1", isUnlocked: true });

    mockWaitForUiSnapshotMatch.mockImplementation(
      async (
        receivedQueryClient: QueryClient,
        predicate: (snapshot: UiSnapshot) => boolean,
        opts?: { timeoutMs?: number },
      ) => {
        expect(receivedQueryClient).toBe(queryClient);
        expect(opts).toEqual({ timeoutMs: 2_000 });
        expect(predicate(lockedSnapshot)).toBe(false);
        expect(predicate(wrongApprovalSnapshot)).toBe(false);
        expect(predicate(readySnapshot)).toBe(true);
        return readySnapshot;
      },
    );

    await expect(waitForRequestedSendApproval(queryClient, "approval-1")).resolves.toBe(true);
  });

  it("requests a send approval and navigates to its detail route once visible", async () => {
    const queryClient = new QueryClient();
    const navigateToApprovalRoute = vi.fn<(...args: [string]) => Promise<void>>().mockResolvedValue(undefined);
    const input = {
      to: "0x1111111111111111111111111111111111111111",
      valueEther: "0.25",
      chainRef: "eip155:1",
    };

    mockRequestSendTransactionApproval.mockResolvedValue({ approvalId: "approval-1" });
    mockWaitForUiSnapshotMatch.mockResolvedValue(createSnapshot({ approvalId: "approval-1", isUnlocked: true }));

    await expect(requestSendApprovalAndNavigate({ queryClient, input, navigateToApprovalRoute })).resolves.toBe(
      "approval-1",
    );

    expect(mockRequestSendTransactionApproval).toHaveBeenCalledWith(input);
    expect(navigateToApprovalRoute).toHaveBeenCalledWith("approval-1");
  });

  it("fails when the requested approval never appears in the unlocked wallet state", async () => {
    const queryClient = new QueryClient();
    const navigateToApprovalRoute = vi.fn<(...args: [string]) => Promise<void>>().mockResolvedValue(undefined);

    mockRequestSendTransactionApproval.mockResolvedValue({ approvalId: "approval-1" });
    mockWaitForUiSnapshotMatch.mockResolvedValue(undefined);

    await expect(
      requestSendApprovalAndNavigate({
        queryClient,
        input: {
          to: "0x1111111111111111111111111111111111111111",
          valueEther: "0.25",
          chainRef: "eip155:1",
        },
        navigateToApprovalRoute,
      }),
    ).rejects.toThrow(SEND_APPROVAL_NOT_READY_ERROR);

    expect(navigateToApprovalRoute).not.toHaveBeenCalled();
  });
});
