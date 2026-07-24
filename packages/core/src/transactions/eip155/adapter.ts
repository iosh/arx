import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import type { Eip155AccountSigning } from "../../namespaces/eip155/accountSigning.js";
import { EIP155_NAMESPACE } from "../../namespaces/eip155/constants.js";
import type { TransactionsNamespaceAdapter } from "../namespaceAdapter.js";
import { createEip155TransactionMonitor } from "./monitorTransaction.js";
import { createEip155TransactionPreparer } from "./prepareTransaction.js";
import { createEip155TransactionSubmitter } from "./submitTransaction.js";

export const createEip155TransactionsAdapter = (params: {
  chainJsonRpc: ChainJsonRpc;
  signing: Eip155AccountSigning;
}): TransactionsNamespaceAdapter => {
  const prepareTransaction = createEip155TransactionPreparer({ chainJsonRpc: params.chainJsonRpc });
  const submitTransaction = createEip155TransactionSubmitter(params);
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
    createSigningInput: (prepared) =>
      submitTransaction.createSigningInput({
        chainRef: prepared.chainRef,
        accountId: prepared.accountId,
        transaction: prepared.transaction,
      }),
    sign: submitTransaction.sign,
    broadcast: submitTransaction.broadcast,
    createSubmission: ({ transaction, broadcast }) =>
      broadcast.status === "rejected"
        ? { status: "failed", transaction }
        : { status: "pending", transaction, transactionHash: broadcast.transactionHash },
    inspectPending: monitorTransaction.inspectPending,
    recoverPending: monitorTransaction.recoverPending,
  };
};
