import type { ApprovalController } from "../controllers/approval/types.js";
import type {
  TransactionAccess,
  TransactionCreateProposalResult,
  TransactionRequestApprovalResult,
  TransactionSubmissionResolution,
} from "./access.js";
import type {
  ApprovalDetailInvalidationEvents,
  TransactionApprovalExecutor,
  TransactionRecoveryRuntime,
  TransactionSubmissionTracker,
} from "./orchestration/types.js";
import type { TransactionApprovalPreview, TransactionProposal, TransactionProposalView } from "./proposal/index.js";
import type {
  TransactionProposalBeginCommands,
  TransactionProposalDraftCommands,
  TransactionProposalMeta,
  TransactionProposalReader,
  TransactionProposalRuntimeReader,
} from "./proposal/types.js";
import type { TransactionRecordView as RuntimeTransactionRecordView, TransactionRecordView } from "./record/index.js";
import type { TransactionRecordReader } from "./record/types.js";
import type { SendTransactionApprovalReview } from "./review/types.js";
import type { TransactionCaller } from "./types.js";

const INTERNAL_TRANSACTION_ORIGIN = "https://wallet.arx.internal";

type CreateTransactionAccessDeps = {
  proposalBegin: TransactionProposalBeginCommands;
  proposalDraft: TransactionProposalDraftCommands;
  execution: TransactionApprovalExecutor;
  recovery: TransactionRecoveryRuntime;
  submission: TransactionSubmissionTracker;
  proposalRuntime: TransactionProposalRuntimeReader;
  proposalReader: TransactionProposalReader;
  recordView: TransactionRecordReader;
  approvalDetailInvalidations: ApprovalDetailInvalidationEvents;
  approvals: Pick<ApprovalController, "cancel" | "onFinished">;
  logger?: (message: string, data?: unknown) => void;
};

const createInternalTransactionCaller = (): TransactionCaller => ({
  origin: INTERNAL_TRANSACTION_ORIGIN,
});

const mapPreview = (input: SendTransactionApprovalReview): TransactionApprovalPreview => ({
  updatedAt: input.updatedAt,
  namespaceReview: input.namespaceReview,
  prepare:
    input.prepare.state === "blocked"
      ? { state: "blocked", blocker: input.prepare.blocker }
      : input.prepare.state === "failed"
        ? { state: "failed", error: input.prepare.error }
        : { state: input.prepare.state },
});

const mapProposal = (deps: {
  runtimeView: NonNullable<ReturnType<TransactionProposalRuntimeReader["getProposalStateSnapshot"]>>;
}): TransactionProposal => {
  const { runtimeView } = deps;

  return {
    id: runtimeView.id,
    approvalId: runtimeView.approvalId,
    intent: {
      namespace: runtimeView.namespace,
      chainRef: runtimeView.chainRef,
      account: {
        accountKey: runtimeView.fromAccountKey,
        accountAddress: runtimeView.from,
        ...(runtimeView.requestedAddress ? { requestedAddress: runtimeView.requestedAddress } : {}),
      },
      request: runtimeView.request,
    },
    status: runtimeView.status,
    ...(runtimeView.termination ? { termination: structuredClone(runtimeView.termination) } : {}),
    createdAt: runtimeView.createdAt,
    updatedAt: runtimeView.updatedAt,
    prepare: {
      requestRevision: runtimeView.prepare.requestRevision,
      sessionToken: runtimeView.prepare.sessionToken,
      status: runtimeView.prepare.status,
      prepared: structuredClone(runtimeView.prepare.prepared),
      reviewSnapshot: structuredClone(runtimeView.prepare.reviewSnapshot),
      ...(runtimeView.prepare.blocker ? { blocker: structuredClone(runtimeView.prepare.blocker) } : {}),
      ...(runtimeView.prepare.error ? { error: structuredClone(runtimeView.prepare.error) } : {}),
      ...(runtimeView.prepare.invalidatedBy ? { invalidatedBy: runtimeView.prepare.invalidatedBy } : {}),
    },
  };
};

const toProposalMeta = (
  runtimeView: NonNullable<ReturnType<TransactionProposalRuntimeReader["getProposalStateSnapshot"]>>,
): TransactionProposalMeta => {
  return {
    id: runtimeView.id,
    approvalId: runtimeView.approvalId,
    namespace: runtimeView.namespace,
    chainRef: runtimeView.chainRef,
    origin: runtimeView.origin,
    from: runtimeView.from,
    request: structuredClone(runtimeView.request),
    prepared: structuredClone(runtimeView.prepare.prepared),
    status: runtimeView.status,
    ...(runtimeView.termination ? { termination: structuredClone(runtimeView.termination) } : {}),
    createdAt: runtimeView.createdAt,
    updatedAt: runtimeView.updatedAt,
  };
};

const mapProposalView = (deps: {
  runtimeView: NonNullable<ReturnType<TransactionProposalRuntimeReader["getProposalStateSnapshot"]>>;
  proposalView: NonNullable<ReturnType<TransactionProposalReader["getProposalReviewView"]>>;
}): TransactionProposalView => {
  const preview = deps.proposalView.review ? mapPreview(deps.proposalView.review) : undefined;

  return {
    ...mapProposal({ runtimeView: deps.runtimeView }),
    ...(preview ? { preview } : {}),
  };
};

const mapRecordView = (record: RuntimeTransactionRecordView): TransactionRecordView => ({
  kind: "record",
  id: record.id,
  namespace: record.namespace,
  chainRef: record.chainRef,
  origin: record.origin,
  accountKey: record.accountKey,
  accountAddress: record.accountAddress,
  status: record.status,
  submitted: structuredClone(record.submitted),
  receipt: structuredClone(record.receipt),
  replacementKey: structuredClone(record.replacementKey),
  replacedByRecordId: record.replacedByRecordId,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const bindApprovalAbort = (params: {
  transactionId: string;
  approvalId: string;
  abortSignal: AbortSignal;
  approvals: Pick<ApprovalController, "cancel" | "onFinished">;
  execution: Pick<TransactionApprovalExecutor, "rejectTransaction">;
}) => {
  let didCleanUp = false;
  let unsubscribeFinished = () => {};

  const cleanUp = () => {
    if (didCleanUp) {
      return;
    }
    didCleanUp = true;
    params.abortSignal.removeEventListener("abort", cancelBeforeBroadcast);
    unsubscribeFinished();
    unsubscribeFinished = () => {};
  };

  const cancelBeforeBroadcast = () => {
    cleanUp();
    void params.approvals.cancel({
      approvalId: params.approvalId,
      reason: "caller_disconnected",
    });
    void params.execution.rejectTransaction({
      id: params.transactionId,
      terminationReason: "approval_cancelled",
      reason: {
        name: "TransportDisconnectedError",
        message: "Transport disconnected.",
        code: 4900,
      },
    });
  };

  if (params.abortSignal.aborted) {
    cancelBeforeBroadcast();
    return;
  }

  unsubscribeFinished = params.approvals.onFinished((event) => {
    if (event.approvalId === params.approvalId) {
      cleanUp();
    }
  });

  params.abortSignal.addEventListener("abort", cancelBeforeBroadcast, { once: true });
};

export const createTransactionAccess = (deps: CreateTransactionAccessDeps): TransactionAccess => {
  return {
    commands: {
      async createProposal(intent, options): Promise<TransactionCreateProposalResult> {
        const caller = options?.caller ?? createInternalTransactionCaller();
        const proposalMeta = deps.proposalBegin.createProposal(intent, caller);
        return {
          transactionId: proposalMeta.id,
        };
      },
      async requestApproval(transactionId, options): Promise<TransactionRequestApprovalResult> {
        const runtimeView = deps.proposalRuntime.getProposalStateSnapshot(transactionId);
        if (!runtimeView) {
          throw new Error(`Transaction proposal ${transactionId} not found.`);
        }
        if (runtimeView.status !== "active") {
          throw new Error(`Transaction proposal ${transactionId} is no longer pending approval.`);
        }

        const approvalId = deps.proposalBegin.requestApproval(toProposalMeta(runtimeView), options.requester);
        if (options.requestScope?.abortSignal) {
          bindApprovalAbort({
            transactionId,
            approvalId,
            abortSignal: options.requestScope.abortSignal,
            approvals: deps.approvals,
            execution: deps.execution,
          });
        }

        return {
          approvalId,
        };
      },
      async editRequest(input) {
        await deps.proposalDraft.applyDraftEdit(input);
      },
      async recomputePrepare(transactionId) {
        await deps.proposalDraft.rerunPrepare(transactionId);
      },
      async approve(transactionId) {
        const result = await deps.execution.approveTransaction(transactionId);
        if (result.status === "approved") {
          return result;
        }

        const runtimeView = deps.proposalRuntime.getProposalStateSnapshot(transactionId);
        if (!runtimeView) {
          return {
            status: "failed",
            reason: result.reason,
            message: result.message,
            ...(result.data !== undefined ? { data: result.data } : {}),
          };
        }

        return {
          status: "failed",
          reason: result.reason,
          transaction: mapProposal({ runtimeView }),
          message: result.message,
          ...(result.data !== undefined ? { data: result.data } : {}),
        };
      },
      async reject(input) {
        await deps.execution.rejectTransaction({
          id: input.transactionId,
          ...(input.reason ? { reason: input.reason } : {}),
          terminationReason: input.terminationReason,
        });
      },
    },
    queries: {
      getProposalView(transactionId) {
        const runtimeView = deps.proposalRuntime.getProposalStateSnapshot(transactionId);
        const proposalView = deps.proposalReader.getProposalReviewView(transactionId);
        if (!runtimeView || !proposalView) {
          return undefined;
        }

        return mapProposalView({
          runtimeView,
          proposalView,
        });
      },
      getRecordView(transactionId) {
        const record = deps.recordView.getRecordView(transactionId);
        return record ? mapRecordView(record) : undefined;
      },
    },
    submission: {
      async waitForOutcome(transactionId): Promise<TransactionSubmissionResolution> {
        const resolution = await deps.submission.waitForSubmissionOutcome(transactionId);
        return {
          submitted: resolution.submitted,
          ...(resolution.persistenceFailure ? { persistenceFailure: resolution.persistenceFailure } : {}),
        };
      },
    },
    recovery: {
      async resume() {
        await deps.recovery.resumeTransactions();
      },
    },
    events: {
      onProposalChanged(handler) {
        return deps.proposalRuntime.onChanged(handler);
      },
      onRecordChanged(handler) {
        return deps.recordView.onChanged(handler);
      },
      onApprovalDetailInvalidated(handler) {
        return deps.approvalDetailInvalidations.onChanged((change) => handler(change.approvalIds));
      },
    },
  };
};
