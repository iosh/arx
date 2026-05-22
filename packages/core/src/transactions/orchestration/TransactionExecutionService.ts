import type { TransactionProposalTerminationReason } from "../proposal/index.js";
import type { TransactionProposalApprovalService } from "../proposal/TransactionProposalApprovalService.js";
import type { TransactionProposalRuntime } from "../proposal/TransactionProposalRuntime.js";
import type { TransactionError } from "../types.js";
import type { TransactionExecutionAttemptPhase, TransactionExecutionPipeline } from "./TransactionExecutionPipeline.js";
import type { TransactionApprovalExecutor, TransactionApprovalResult } from "./types.js";

type TransactionExecutionServiceDeps = {
  proposalApprovals: Pick<TransactionProposalApprovalService, "approvePendingProposal">;
  proposalRuntime: Pick<TransactionProposalRuntime, "listExecutableProposalIds" | "peek">;
  pipeline: Pick<TransactionExecutionPipeline, "executeApprovedTransaction" | "rejectTransaction">;
  now: () => number;
};

type TransactionExecutionAttemptState = {
  phase: TransactionExecutionAttemptPhase;
  signAbortController: AbortController | null;
};

export class TransactionExecutionService implements TransactionApprovalExecutor {
  #proposalApprovals: Pick<TransactionProposalApprovalService, "approvePendingProposal">;
  #proposalRuntime: Pick<TransactionProposalRuntime, "listExecutableProposalIds" | "peek">;
  #pipeline: Pick<TransactionExecutionPipeline, "executeApprovedTransaction" | "rejectTransaction">;
  #now: () => number;

  #queue: string[] = [];
  #queued = new Set<string>();
  #processing = new Set<string>();
  #scheduled = false;
  #attempts = new Map<string, TransactionExecutionAttemptState>();

  constructor(deps: TransactionExecutionServiceDeps) {
    this.#proposalApprovals = deps.proposalApprovals;
    this.#proposalRuntime = deps.proposalRuntime;
    this.#pipeline = deps.pipeline;
    this.#now = deps.now;
  }

  async approveTransaction(id: string): Promise<TransactionApprovalResult> {
    const result = this.#proposalApprovals.approvePendingProposal(id);
    if (result.status === "failed") {
      return result;
    }

    this.#enqueue(id);
    return result;
  }

  async rejectTransaction(input: {
    id: string;
    reason?: Error | TransactionError;
    terminationReason: TransactionProposalTerminationReason;
  }): Promise<void> {
    this.#removeFromQueue(input.id);
    const attempt = this.#attempts.get(input.id) ?? null;
    if (attempt) {
      if (attempt.phase === "signing") {
        attempt.signAbortController?.abort(input.reason);
      }
      if (this.#isIrreversibleAttempt(attempt.phase)) {
        return;
      }
    }

    await this.#pipeline.rejectTransaction(input);
  }

  async executeApprovedTransaction(id: string): Promise<void> {
    try {
      await this.#pipeline.executeApprovedTransaction(id, {
        canContinue: () => this.#canContinueAttempt(id),
        setAttemptPhase: (phase, signAbortController) => this.#setAttemptPhase(id, phase, signAbortController ?? null),
      });
    } finally {
      this.#attempts.delete(id);
    }
  }

  async resumeApprovedProposals(): Promise<void> {
    for (const proposalId of this.#proposalRuntime.listExecutableProposalIds()) {
      this.#enqueue(proposalId);
    }
  }

  #enqueue(id: string) {
    if (this.#processing.has(id) || this.#queued.has(id)) {
      return;
    }

    this.#queued.add(id);
    this.#attempts.set(id, {
      phase: "queued",
      signAbortController: null,
    });
    this.#queue.push(id);
    this.#scheduleProcess();
  }

  #scheduleProcess() {
    if (this.#scheduled) {
      return;
    }

    this.#scheduled = true;
    Promise.resolve().then(() => {
      this.#scheduled = false;
      void this.#processQueue();
    });
  }

  async #processQueue() {
    const next = this.#queue.shift();
    if (!next) {
      return;
    }

    this.#queued.delete(next);
    if (this.#processing.has(next)) {
      this.#scheduleProcess();
      return;
    }

    this.#processing.add(next);
    try {
      await this.executeApprovedTransaction(next);
    } finally {
      this.#processing.delete(next);
      if (this.#queue.length > 0) {
        this.#scheduleProcess();
      }
    }
  }

  #canContinueAttempt(id: string): boolean {
    const proposal = this.#proposalRuntime.peek(id);
    return proposal?.status === "approved";
  }

  #setAttemptPhase(
    id: string,
    phase: TransactionExecutionAttemptPhase,
    signAbortController: AbortController | null = null,
  ): void {
    this.#attempts.set(id, {
      phase,
      signAbortController,
    });
  }

  #removeFromQueue(id: string): void {
    this.#queued.delete(id);
    if (this.#queue.length === 0) {
      return;
    }

    this.#queue = this.#queue.filter((queuedId) => queuedId !== id);
  }

  #isIrreversibleAttempt(phase: TransactionExecutionAttemptPhase | undefined): boolean {
    return phase === "broadcasting" || phase === "persisting_record";
  }
}
