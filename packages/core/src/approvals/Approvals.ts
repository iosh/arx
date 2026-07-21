import type { CoreTime } from "../runtime/time.js";
import { createDeferred } from "../utils/deferred.js";
import {
  ApprovalCancelledError,
  ApprovalNotFoundError,
  ApprovalRejectedError,
  ApprovalTimeoutError,
} from "./errors.js";
import type {
  Approval,
  ApprovalDecision,
  ApprovalDraft,
  ApprovalHandle,
  ApprovalId,
  ApprovalsChanged,
  ApprovalsReader,
} from "./types.js";

export const APPROVAL_TIMEOUT_MS = 5 * 60_000;

export type ApprovalsOptions = Readonly<{
  time: CoreTime;
  publishChanged(change: ApprovalsChanged): void;
}>;

type PendingApproval = Readonly<{
  approval: Approval;
  resolve(decision: ApprovalDecision): void;
  reject(error: Error): void;
  cancelTimeout(): void;
}>;

/** Owns pending dapp approvals and their promise settlement. */
export class Approvals implements ApprovalsReader {
  readonly #time: CoreTime;
  readonly #publishChanged: (change: ApprovalsChanged) => void;
  readonly #pending = new Map<ApprovalId, PendingApproval>();

  constructor(options: ApprovalsOptions) {
    this.#time = options.time;
    this.#publishChanged = options.publishChanged;
  }

  get(approvalId: ApprovalId): Approval {
    const pending = this.#pending.get(approvalId);
    if (!pending) throw new ApprovalNotFoundError(approvalId);
    return pending.approval;
  }

  list(): readonly Approval[] {
    return [...this.#pending.values()].map(({ approval }) => approval);
  }

  request<TType extends Approval["type"]>(
    draft: ApprovalDraft<Extract<Approval, { type: TType }>>,
  ): ApprovalHandle<Extract<ApprovalDecision, { type: TType }>>;
  request(draft: ApprovalDraft): ApprovalHandle {
    const approvalId = globalThis.crypto.randomUUID();
    const approval: Approval = {
      ...draft,
      approvalId,
      createdAt: this.#time.now(),
    };

    const deferred = createDeferred<ApprovalDecision>();
    const cancelTimeout = this.#time.schedule(APPROVAL_TIMEOUT_MS, () => this.#timeout(approvalId));

    this.#pending.set(approvalId, {
      approval,
      resolve: deferred.resolve,
      reject: deferred.reject,
      cancelTimeout,
    });
    this.#publish([approvalId]);

    return {
      approvalId,
      decision: deferred.promise,
      cancel: () => this.cancel([approvalId]),
    };
  }

  approve(decision: ApprovalDecision): void {
    const pending = this.#takeRequired(decision.approvalId);
    this.#publish([decision.approvalId]);
    pending.resolve(decision);
  }

  reject(approvalId: ApprovalId): void {
    const pending = this.#takeRequired(approvalId);
    this.#publish([approvalId]);
    pending.reject(new ApprovalRejectedError());
  }

  cancel(approvalIds: readonly ApprovalId[]): void {
    const removed = this.#takeExisting(approvalIds);
    if (removed.length === 0) return;

    this.#publish(removed.map(({ approval }) => approval.approvalId));
    for (const pending of removed) pending.reject(new ApprovalCancelledError());
  }

  cancelAll(): void {
    this.cancel([...this.#pending.keys()]);
  }

  #timeout(approvalId: ApprovalId): void {
    const [pending] = this.#takeExisting([approvalId]);
    if (!pending) return;

    this.#publish([approvalId]);
    pending.reject(new ApprovalTimeoutError());
  }

  #takeRequired(approvalId: ApprovalId): PendingApproval {
    const [pending] = this.#takeExisting([approvalId]);
    if (!pending) throw new ApprovalNotFoundError(approvalId);
    return pending;
  }

  #takeExisting(approvalIds: readonly ApprovalId[]): PendingApproval[] {
    const removed: PendingApproval[] = [];

    for (const approvalId of approvalIds) {
      const pending = this.#pending.get(approvalId);
      if (!pending) continue;

      this.#pending.delete(approvalId);
      pending.cancelTimeout();
      removed.push(pending);
    }

    return removed;
  }

  #publish(approvalIds: readonly ApprovalId[]): void {
    this.#publishChanged({ type: "approvalsChanged", approvalIds });
  }
}
