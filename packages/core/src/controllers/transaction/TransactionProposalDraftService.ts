import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { NamespaceTransactionDraftEdit, TransactionRequest } from "../../transactions/types.js";
import { isProposalTerminal } from "./status.js";
import type { TransactionPrepareManager } from "./TransactionPrepareManager.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionProposalMeta } from "./types.js";
import { buildProposalStateContext } from "./utils.js";

type TransactionProposalDraftServiceDeps = {
  proposalStore: TransactionProposalStore;
  namespaces: NamespaceTransactions;
  prepare: Pick<TransactionPrepareManager, "queuePrepare">;
  now: () => number;
};

export class TransactionProposalDraftService {
  #proposalStore: TransactionProposalStore;
  #namespaces: NamespaceTransactions;
  #prepare: Pick<TransactionPrepareManager, "queuePrepare">;
  #now: () => number;

  constructor(deps: TransactionProposalDraftServiceDeps) {
    this.#proposalStore = deps.proposalStore;
    this.#namespaces = deps.namespaces;
    this.#prepare = deps.prepare;
    this.#now = deps.now;
  }

  async rerunPrepare(transactionId: string): Promise<void> {
    const proposal = this.#proposalStore.peek(transactionId);
    if (!proposal || isProposalTerminal(proposal)) {
      return;
    }

    this.#proposalStore.restartPrepare({
      id: transactionId,
      updatedAt: this.#now(),
    });
    this.#prepare.queuePrepare(transactionId);
  }

  async applyDraftEdit(input: {
    transactionId: string;
    edit: NamespaceTransactionDraftEdit;
    mode?: string;
  }): Promise<void> {
    const meta = this.#proposalStore.get(input.transactionId);
    const proposal = this.#proposalStore.peek(input.transactionId);
    if (!meta || !proposal || isProposalTerminal(proposal)) {
      return;
    }
    if (proposal.phase !== "pending") {
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

    const request = this.#requireRuntimeRequest(meta);
    const nextRequest = namespaceTransaction.proposal.applyDraftEdit({
      ...buildProposalStateContext(meta),
      request: structuredClone({
        ...request,
        chainRef: request.chainRef,
      }),
      edit: input.edit,
      ...(input.mode ? { mode: input.mode } : {}),
    });

    const edited = this.#proposalStore.replacePendingDraftRequest({
      id: meta.id,
      request: structuredClone(nextRequest),
      updatedAt: this.#now(),
    });
    if (!edited) {
      throw new Error("Transaction draft can only be edited before approval.");
    }

    await this.rerunPrepare(meta.id);
  }

  #requireRuntimeRequest(meta: TransactionProposalMeta): TransactionRequest {
    return meta.request;
  }
}
