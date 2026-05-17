import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { NamespaceTransactionDraftEdit } from "../../transactions/types.js";
import type { TransactionPrepare } from "./TransactionPrepare.js";
import type { TransactionProposalRuntime } from "./TransactionProposalRuntime.js";
import { buildProposalStateContext } from "./utils.js";

type TransactionProposalDraftServiceDeps = {
  proposalRuntime: TransactionProposalRuntime;
  namespaces: NamespaceTransactions;
  prepare: Pick<TransactionPrepare, "rerun">;
  now: () => number;
};

export class TransactionProposalDraftService {
  #proposalRuntime: TransactionProposalRuntime;
  #namespaces: NamespaceTransactions;
  #prepare: Pick<TransactionPrepare, "rerun">;
  #now: () => number;

  constructor(deps: TransactionProposalDraftServiceDeps) {
    this.#proposalRuntime = deps.proposalRuntime;
    this.#namespaces = deps.namespaces;
    this.#prepare = deps.prepare;
    this.#now = deps.now;
  }

  async rerunPrepare(transactionId: string): Promise<void> {
    const proposal = this.#proposalRuntime.get(transactionId);
    if (!proposal || proposal.status !== "pending") {
      return;
    }

    this.#prepare.rerun(transactionId);
  }

  async applyDraftEdit(input: {
    transactionId: string;
    edit: NamespaceTransactionDraftEdit;
    mode?: string;
  }): Promise<void> {
    const meta = this.#proposalRuntime.get(input.transactionId);
    if (!meta || meta.status === "failed") {
      return;
    }
    if (meta.status !== "pending") {
      throw new Error("Transaction draft can only be edited before approval.");
    }

    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    if (!namespaceTransaction?.proposal?.applyDraftEdit) {
      throw new Error(`Transaction draft edits are not supported for namespace "${meta.namespace}".`);
    }
    if (input.edit.namespace !== meta.namespace) {
      throw new Error(
        `Transaction draft edit namespace mismatch: proposal=${meta.namespace} edit=${input.edit.namespace}`,
      );
    }

    const nextRequest = namespaceTransaction.proposal.applyDraftEdit({
      ...buildProposalStateContext(meta),
      request: structuredClone(meta.request),
      edit: input.edit,
      ...(input.mode ? { mode: input.mode } : {}),
    });

    const edited = this.#proposalRuntime.replacePendingDraftRequest({
      id: meta.id,
      request: structuredClone(nextRequest),
      updatedAt: this.#now(),
    });
    if (edited.status !== "updated") {
      throw new Error("Transaction draft can only be edited before approval.");
    }

    this.#prepare.rerun(meta.id);
  }
}
