import type { RequestContext } from "../../rpc/requestContext.js";
import type { TransactionError, TransactionRequest } from "../../transactions/types.js";
import type {
  BeginTransactionApprovalOptions,
  ProviderTransactionApprovalCommands,
  TransactionApprovalExecutor,
  TransactionApprovalHandoff,
  TransactionProposalBeginCommands,
  TransactionSubmissionTracker,
} from "./types.js";

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

  async beginTransactionApproval(
    request: TransactionRequest,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
  ): Promise<TransactionApprovalHandoff> {
    const handoff = await this.#begin.beginTransactionApproval(request, requestContext, options);
    const abortSignal = options.requestBinding?.signal ?? null;

    if (!abortSignal) {
      return {
        ...handoff,
        waitForProviderCompletion: () => this.#submission.waitForSubmissionOutcome(handoff.transactionId),
      };
    }

    const cancelBeforeBroadcast = () => {
      void this.#execution.rejectTransaction(handoff.transactionId, createTransactionTransportDisconnectedError());
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
      ...handoff,
      waitForProviderCompletion: async () => {
        try {
          return await this.#submission.waitForSubmissionOutcome(handoff.transactionId);
        } finally {
          cleanup();
        }
      },
    };
  }
}
