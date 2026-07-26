import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import type { Eip155AccountSigning } from "../../namespaces/eip155/accountSigning.js";
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
  signing: Eip155AccountSigning;
  pendingTransactionsReader: Pick<TransactionsReader, "listPending">;
}): TransactionsNamespaceAdapter => {
  const prepareTransaction = createEip155TransactionPreparer({ chainJsonRpc: params.chainJsonRpc });
  const submitTransaction = createEip155TransactionSubmitter({
    chainJsonRpc: params.chainJsonRpc,
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
    createSubmission: ({ transaction, broadcast }) =>
      broadcast.status === "rejected"
        ? { status: "failed", transaction, failure: broadcast.failure }
        : { status: "pending", transaction, transactionHash: broadcast.transactionHash },
    inspectPending: monitorTransaction.inspectPending,
    recoverPending: monitorTransaction.recoverPending,
  };
};
