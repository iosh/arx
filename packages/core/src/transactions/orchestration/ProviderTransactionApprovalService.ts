import type { ApprovalRequester } from "../../controllers/approval/types.js";
import type { TransactionIntent } from "../intent/index.js";
import type { TransactionProposalBeginCommands } from "../proposal/types.js";
import type {
  BeginTransactionApprovalOptions,
  ProviderTransactionApprovalCommands,
  ProviderTransactionSubmission,
} from "../provider/types.js";
import type { TransactionError } from "../types.js";
import type { TransactionApprovalExecutor, TransactionSubmissionTracker } from "./types.js";

const createTransactionTransportDisconnectedError = (): TransactionError => ({
  name: "TransportDisconnectedError",
  message: "Transport disconnected.",
  code: 4900,
});

type ProviderTransactionApprovalServiceOptions = {
  begin: TransactionProposalBeginCommands;
  execution: Pick<TransactionApprovalExecutor, "rejectTransaction">;
  submission: Pick<TransactionSubmissionTracker, "waitForSubmissionOutcome">;
};

export class ProviderTransactionApprovalService implements ProviderTransactionApprovalCommands {
  #begin: TransactionProposalBeginCommands;
  #execution: Pick<TransactionApprovalExecutor, "rejectTransaction">;
  #submission: Pick<TransactionSubmissionTracker, "waitForSubmissionOutcome">;

  constructor(options: ProviderTransactionApprovalServiceOptions) {
    this.#begin = options.begin;
    this.#execution = options.execution;
    this.#submission = options.submission;
  }

  beginTransactionApproval(
    intent: TransactionIntent,
    requester: ApprovalRequester,
    options: BeginTransactionApprovalOptions,
  ): ProviderTransactionSubmission {
    const submission = this.#begin.beginTransactionApproval(intent, requester, options);
    const abortSignal = options.requestScope?.abortSignal ?? null;

    if (!abortSignal) {
      return {
        ...submission,
        waitForSubmission: () => this.#submission.waitForSubmissionOutcome(submission.transactionId),
      };
    }

    const cancelBeforeBroadcast = () => {
      void this.#execution.rejectTransaction({
        id: submission.transactionId,
        reason: createTransactionTransportDisconnectedError(),
        terminationReason: "approval_cancelled",
      });
    };

    let cleanupAbortBinding = () => {};
    let isCleanedUp = false;
    const cleanup = () => {
      if (isCleanedUp) {
        return;
      }
      isCleanedUp = true;
      cleanupAbortBinding();
      cleanupAbortBinding = () => {};
    };

    if (abortSignal.aborted) {
      cancelBeforeBroadcast();
    } else {
      abortSignal.addEventListener("abort", cancelBeforeBroadcast, { once: true });
      cleanupAbortBinding = () => {
        abortSignal.removeEventListener("abort", cancelBeforeBroadcast);
      };
    }

    return {
      ...submission,
      waitForSubmission: async () => {
        try {
          return await this.#submission.waitForSubmissionOutcome(submission.transactionId);
        } finally {
          cleanup();
        }
      },
    };
  }
}
