import type { RequestContext } from "../../rpc/requestContext.js";
import type { TransactionError, TransactionRequest } from "../../transactions/types.js";
import { isProposalTerminal, isTransactionRecordTerminal } from "./status.js";
import type {
  BeginTransactionApprovalOptions,
  ProviderTransactionApprovalCommands,
  TransactionApprovalCommands,
  TransactionApprovalExecutor,
  TransactionApprovalHandoff,
  TransactionProposalReader,
  TransactionRecordReader,
  TransactionSubmissionTracker,
} from "./types.js";

const createTransactionTransportDisconnectedError = (): TransactionError => ({
  name: "TransportDisconnectedError",
  message: "Transport disconnected.",
  code: 4900,
});

type ProviderTransactionApprovalServiceOptions = {
  commands: TransactionApprovalCommands;
  execution: Pick<TransactionApprovalExecutor, "rejectTransaction">;
  submission: Pick<TransactionSubmissionTracker, "waitForSubmissionOutcome">;
  proposals: Pick<TransactionProposalReader, "getProposalView">;
  records: Pick<TransactionRecordReader, "getRecordView">;
};

export class ProviderTransactionApprovalService implements ProviderTransactionApprovalCommands {
  #commands: TransactionApprovalCommands;
  #execution: Pick<TransactionApprovalExecutor, "rejectTransaction">;
  #submission: Pick<TransactionSubmissionTracker, "waitForSubmissionOutcome">;
  #proposals: Pick<TransactionProposalReader, "getProposalView">;
  #records: Pick<TransactionRecordReader, "getRecordView">;

  constructor(options: ProviderTransactionApprovalServiceOptions) {
    this.#commands = options.commands;
    this.#execution = options.execution;
    this.#submission = options.submission;
    this.#proposals = options.proposals;
    this.#records = options.records;
  }

  async beginTransactionApproval(
    request: TransactionRequest,
    requestContext: RequestContext,
    options: BeginTransactionApprovalOptions,
  ): Promise<TransactionApprovalHandoff> {
    const handoff = await this.#commands.beginTransactionApproval(request, requestContext, options);
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

    const tryCleanupFromTerminalState = () => {
      const proposal = this.#proposals.getProposalView(handoff.transactionId);
      if (!proposal) {
        cleanup();
        return;
      }
      if (isProposalTerminal(proposal)) {
        cleanup();
        return;
      }

      const record = this.#records.getRecordView(handoff.transactionId);
      if (record && isTransactionRecordTerminal(record)) {
        cleanup();
      }
    };

    if (abortSignal.aborted) {
      cancelBeforeBroadcast();
      tryCleanupFromTerminalState();
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
