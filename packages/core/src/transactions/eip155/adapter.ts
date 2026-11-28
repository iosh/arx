import type { Address } from "ox/Address";
import type { Hex } from "ox/Hex";
import type { ChainJsonRpc } from "../../chainJsonRpc/ChainJsonRpc.js";
import type { Eip155AccountSigning } from "../../namespaces/eip155/accountSigning.js";
import type { BroadcastEip155RawTransaction } from "../../namespaces/eip155/broadcastRawTransaction.js";
import { EIP155_NAMESPACE } from "../../namespaces/eip155/constants.js";
import { TransactionReplacementUnavailableError } from "../errors.js";
import type { TransactionsNamespaceAdapter } from "../namespaceAdapter.js";
import type { TransactionsReader } from "../persistence.js";
import type { Transaction, TransactionReplacementType } from "../types.js";
import { Eip155CancellationUnavailableError } from "./errors.js";
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

  const checkReplacementOnChain = async (target: Transaction, type: TransactionReplacementType) => {
    const { chainRef, transaction, transactionId } = target;
    const { from } = transaction;
    const targetNonce = BigInt(transaction.nonce);
    const isCancellation = type === "cancel";
    const block = isCancellation
      ? await params.chainJsonRpc.request<Hex>({ chainRef, method: "eth_blockNumber" })
      : "latest";
    const nonce = await params.chainJsonRpc.request<Hex>({
      chainRef,
      method: "eth_getTransactionCount",
      params: [from, block],
    });
    const nextNonce = BigInt(nonce);

    if (nextNonce > targetNonce) {
      throw new TransactionReplacementUnavailableError({
        transactionId,
        status: target.state.status,
        reason: "nonce_consumed",
      });
    }
    if (!isCancellation) return;

    // An authorization at an earlier nonce can add code before a queued self-transfer executes.
    if (nextNonce < targetNonce) {
      throw new Eip155CancellationUnavailableError(chainRef, from, "earlier_nonce_pending");
    }

    const code = await params.chainJsonRpc.request<Hex>({
      chainRef,
      method: "eth_getCode",
      params: [from, block],
    });
    if (code !== "0x") throw new Eip155CancellationUnavailableError(chainRef, from, "account_has_code");
  };

  return {
    namespace: EIP155_NAMESPACE,
    async prepare({ request, from }) {
      const transaction = await prepareTransaction({
        chainRef: request.chainRef,
        // Accounts supplies the canonical address for this namespace.
        from: from as Address,
        transaction: request.transaction,
      });

      return { ...request, transaction };
    },
    async prepareReplacement({ target, type }) {
      await checkReplacementOnChain(target, type);
      const request = createEip155ReplacementRequest({ target: target.transaction, type });
      const transaction = await prepareTransaction({
        chainRef: target.chainRef,
        from: target.transaction.from,
        transaction: request,
        replacement: target.transaction,
      });

      return {
        namespace: EIP155_NAMESPACE,
        chainRef: target.chainRef,
        accountId: target.accountId,
        transaction,
      };
    },
    async withSigningInput(prepared, use, replacement) {
      if (replacement) await checkReplacementOnChain(replacement.target, replacement.type);
      return nonceCoordinator.withTransactionNonce(
        {
          chainRef: prepared.chainRef,
          transaction: prepared.transaction,
          ...(replacement ? { replacementNonce: replacement.target.transaction.nonce } : {}),
        },
        (transaction) =>
          use({
            chainRef: prepared.chainRef,
            accountId: prepared.accountId,
            transaction,
          }),
      );
    },
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
  };
};
