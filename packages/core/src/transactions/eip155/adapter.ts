import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import type { Eip155AccountSigning } from "../../namespaces/eip155/accountSigning.js";
import type { BroadcastEip155RawTransaction } from "../../namespaces/eip155/broadcastRawTransaction.js";
import { EIP155_NAMESPACE } from "../../namespaces/eip155/constants.js";
import type { TransactionsNamespaceAdapter } from "../namespaceAdapter.js";
import type { TransactionsReader } from "../persistence.js";
import { createEip155TransactionMonitor } from "./monitorTransaction.js";
import { createEip155NonceCoordinator } from "./nonceCoordinator.js";
import { createEip155TransactionPreparer } from "./prepareTransaction.js";
import { createEip155ReplacementRequest } from "./replacementTransaction.js";
import { createEip155TransactionSubmitter } from "./submitTransaction.js";

export const createEip155TransactionsAdapter = (params: {
  chainJsonRpc: ChainJsonRpc;
  broadcastRawTransaction: BroadcastEip155RawTransaction;
  signing: Eip155AccountSigning;
  pendingTransactionsReader: Pick<TransactionsReader, "listPending">;
}): TransactionsNamespaceAdapter => {
  const prepareTransaction = createEip155TransactionPreparer({ chainJsonRpc: params.chainJsonRpc });
  const submitTransaction = createEip155TransactionSubmitter({
    broadcastRawTransaction: params.broadcastRawTransaction,
    signing: params.signing,
  });
  const nonceCoordinator = createEip155NonceCoordinator({
    chainJsonRpc: params.chainJsonRpc,
    listPending: () => params.pendingTransactionsReader.listPending(),
  });
  const monitorTransaction = createEip155TransactionMonitor({
    chainJsonRpc: params.chainJsonRpc,
    broadcast: submitTransaction.broadcast,
  });

  return {
    namespace: EIP155_NAMESPACE,
    async prepare({ request, from }) {
      const transaction = await prepareTransaction({
        chainRef: request.chainRef,
        from,
        transaction: request.transaction,
      });

      return { ...request, transaction };
    },
    async prepareReplacement({ target, type, from }) {
      const request = createEip155ReplacementRequest({ target, type, from });
      const transaction = await prepareTransaction({
        chainRef: target.chainRef,
        from,
        transaction: request,
      });

      return {
        namespace: EIP155_NAMESPACE,
        chainRef: target.chainRef,
        accountId: target.accountId,
        transaction,
      };
    },
    withSigningInput: (prepared, use) =>
      nonceCoordinator.withTransactionNonce(
        {
          chainRef: prepared.chainRef,
          transaction: prepared.transaction,
        },
        (transaction) =>
          use({
            chainRef: prepared.chainRef,
            accountId: prepared.accountId,
            transaction,
          }),
      ),
    sign: submitTransaction.sign,
    broadcast: submitTransaction.broadcast,
    createSubmission: ({ transaction, broadcast, transactionHash }) => {
      const { state } = transaction;
      const included =
        state.status === "confirmed" || (state.status === "failed" && state.failure.type === "execution");
      return broadcast.status === "rejected" && !included
        ? { status: "failed", transaction, failure: broadcast.failure }
        : { status: "pending", transaction, transactionHash };
    },
    inspectPending: monitorTransaction.inspectPending,
    recoverPending: monitorTransaction.recoverPending,
  };
};
