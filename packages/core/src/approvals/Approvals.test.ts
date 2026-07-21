import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreTime } from "../runtime/time.js";
import { APPROVAL_TIMEOUT_MS, Approvals } from "./Approvals.js";
import {
  ApprovalCancelledError,
  ApprovalNotFoundError,
  ApprovalRejectedError,
  ApprovalTimeoutError,
} from "./errors.js";
import type { AccountAccessApproval, ApprovalDraft, ApprovalsChanged } from "./types.js";

const accountAccessDraft = {
  namespace: "eip155",
  type: "accountAccess",
  origin: "https://dapp.example",
  request: {
    selectableAccounts: [
      {
        accountId: "account-1",
        chainRef: "eip155:1",
        canonicalAddress: "0x0000000000000000000000000000000000000001",
        displayAddress: "0x0000...0001",
      },
    ],
  },
} as const satisfies ApprovalDraft<AccountAccessApproval>;

type ScheduledTask = {
  delayMs: number;
  task(): void;
  cancelled: boolean;
};

type RandomUuid = ReturnType<typeof globalThis.crypto.randomUUID>;

const approvalId = (value: number): RandomUuid =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}` as RandomUuid;

afterEach(() => {
  vi.restoreAllMocks();
});

const createHarness = (onChanged?: (change: ApprovalsChanged, approvals: Approvals) => void) => {
  const events: ApprovalsChanged[] = [];
  const scheduled: ScheduledTask[] = [];
  let nextId = 1;
  let nowCalls = 0;
  let approvals: Approvals;

  const time: CoreTime = {
    now: () => {
      nowCalls += 1;
      return 1_000;
    },
    schedule: (delayMs, task) => {
      const scheduledTask: ScheduledTask = { delayMs, task, cancelled: false };
      scheduled.push(scheduledTask);
      return () => {
        scheduledTask.cancelled = true;
      };
    },
  };

  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => approvalId(nextId++));

  approvals = new Approvals({
    time,
    publishChanged: (change) => {
      events.push(change);
      onChanged?.(change, approvals);
    },
  });

  return {
    approvals,
    events,
    scheduled,
    getNowCalls: () => nowCalls,
  };
};

describe("Approvals", () => {
  it("creates pending approvals with owner-generated identity and time before publishing", () => {
    const visibleDuringPublish: string[][] = [];
    const harness = createHarness((_change, approvals) => {
      visibleDuringPublish.push(approvals.list().map(({ approvalId }) => approvalId));
    });

    const first = harness.approvals.request(accountAccessDraft);
    const second = harness.approvals.request(accountAccessDraft);

    expect(first.approvalId).toBe(approvalId(1));
    expect(second.approvalId).toBe(approvalId(2));
    expect(harness.approvals.get(first.approvalId)).toEqual({
      ...accountAccessDraft,
      approvalId: approvalId(1),
      createdAt: 1_000,
    });
    expect(harness.approvals.list().map(({ approvalId }) => approvalId)).toEqual([approvalId(1), approvalId(2)]);
    expect(visibleDuringPublish).toEqual([[approvalId(1)], [approvalId(1), approvalId(2)]]);
    expect(harness.events).toEqual([
      { type: "approvalsChanged", approvalIds: [approvalId(1)] },
      { type: "approvalsChanged", approvalIds: [approvalId(2)] },
    ]);
    expect(harness.scheduled.map(({ delayMs }) => delayMs)).toEqual([APPROVAL_TIMEOUT_MS, APPROVAL_TIMEOUT_MS]);
    expect(harness.getNowCalls()).toBe(2);
  });

  it("removes and publishes before resolving an approved decision", async () => {
    const order: string[] = [];
    let recordCountDuringSettlementEvent = -1;
    const harness = createHarness((_change, approvals) => {
      if (order.length > 0) {
        recordCountDuringSettlementEvent = approvals.list().length;
        order.push("published");
      }
    });
    const handle = harness.approvals.request(accountAccessDraft);
    const settled = handle.decision.then((decision) => {
      order.push("settled");
      return decision;
    });
    order.push("approving");

    const decision = {
      approvalId: handle.approvalId,
      type: "accountAccess",
      accountIds: ["account-1"],
    } as const;
    harness.approvals.approve(decision);

    await expect(settled).resolves.toBe(decision);
    expect(recordCountDuringSettlementEvent).toBe(0);
    expect(order).toEqual(["approving", "published", "settled"]);
    expect(harness.scheduled[0]?.cancelled).toBe(true);
    expect(() => harness.approvals.get(handle.approvalId)).toThrow(ApprovalNotFoundError);
    expect(() => harness.approvals.approve(decision)).toThrow(ApprovalNotFoundError);
  });

  it("rejects from the trusted API and lets a settled handle cancel without another event", async () => {
    const harness = createHarness();
    const rejected = harness.approvals.request(accountAccessDraft);
    const rejectedError = rejected.decision.catch((error: unknown) => error);

    harness.approvals.reject(rejected.approvalId);
    await expect(rejectedError).resolves.toBeInstanceOf(ApprovalRejectedError);

    const cancelled = harness.approvals.request(accountAccessDraft);
    const cancelledError = cancelled.decision.catch((error: unknown) => error);
    cancelled.cancel();
    await expect(cancelledError).resolves.toBeInstanceOf(ApprovalCancelledError);

    const eventCount = harness.events.length;
    cancelled.cancel();
    expect(harness.events).toHaveLength(eventCount);
  });

  it("times out through CoreTime and removes the pending approval", async () => {
    let visibleDuringTimeoutEvent = true;
    const harness = createHarness((_change, approvals) => {
      if (harness.scheduled.length > 0) visibleDuringTimeoutEvent = approvals.list().length > 0;
    });
    const handle = harness.approvals.request(accountAccessDraft);
    const timeoutError = handle.decision.catch((error: unknown) => error);

    harness.scheduled[0]?.task();

    await expect(timeoutError).resolves.toBeInstanceOf(ApprovalTimeoutError);
    expect(visibleDuringTimeoutEvent).toBe(false);
    expect(harness.approvals.list()).toEqual([]);
  });

  it("cancels only existing IDs in one event and supports cancel-all", async () => {
    const harness = createHarness();
    const first = harness.approvals.request(accountAccessDraft);
    const second = harness.approvals.request(accountAccessDraft);
    const remaining = harness.approvals.request(accountAccessDraft);
    const firstError = first.decision.catch((error: unknown) => error);
    const secondError = second.decision.catch((error: unknown) => error);
    const remainingError = remaining.decision.catch((error: unknown) => error);
    harness.events.length = 0;

    harness.approvals.cancel([first.approvalId, "missing", second.approvalId, first.approvalId]);

    expect(harness.events).toEqual([{ type: "approvalsChanged", approvalIds: [first.approvalId, second.approvalId] }]);
    await expect(firstError).resolves.toBeInstanceOf(ApprovalCancelledError);
    await expect(secondError).resolves.toBeInstanceOf(ApprovalCancelledError);
    expect(harness.approvals.list().map(({ approvalId }) => approvalId)).toEqual([remaining.approvalId]);

    harness.approvals.cancelAll();
    await expect(remainingError).resolves.toBeInstanceOf(ApprovalCancelledError);
    expect(harness.events[1]).toEqual({ type: "approvalsChanged", approvalIds: [remaining.approvalId] });
  });
});
