import { AccountNotFoundError } from "../../accounts/errors.js";
import type { Approvals } from "../../approvals/Approvals.js";
import { type DappRequestMethod, defineDappMethod, invalidDappParams } from "../../dappConnections/defineDappMethod.js";
import { RpcInvalidParamsError, RpcJsonRpcResponseError, RpcUnauthorizedError } from "../../dappConnections/errors.js";
import {
  Eip155FeeModelUnsupportedError,
  Eip155PriorityFeeExceedsMaxFeeError,
  Eip155TransactionInvalidError,
  Eip155TransactionSigningUnavailableError,
} from "../../transactions/eip155/errors.js";
import type { PreparedTransaction } from "../../transactions/preparedTransaction.js";
import type { Transactions } from "../../transactions/Transactions.js";
import type { TransactionSubmission } from "../../transactions/types.js";
import { chainIdFromChainRef } from "./chainId.js";
import { EIP155_NAMESPACE } from "./constants.js";
import { type AuthorizedAccountDependencies, getAuthorizedAccount } from "./dappAccount.js";
import { decodeSendTransactionParams } from "./transactionRequest.js";

type CreateEip155DappTransactionHandlersOptions = AuthorizedAccountDependencies &
  Readonly<{
    approvals: Pick<Approvals, "request">;
    transactions: Pick<Transactions, "prepare" | "submit">;
  }>;

export const createEip155DappTransactionHandlers = (
  options: CreateEip155DappTransactionHandlersOptions,
): Readonly<{ sendTransaction: DappRequestMethod }> => ({
  sendTransaction: defineDappMethod({
    decode: decodeSendTransactionParams,
    execute: async ({ origin, chainRef, params }) => {
      if (params.requestedChainId !== undefined && params.requestedChainId !== chainIdFromChainRef(chainRef)) {
        throw invalidDappParams("eth_sendTransaction", "chainId must match the active chain.");
      }

      const authorization = {
        origin,
        chainRef,
        address: params.from,
      };
      const account = getAuthorizedAccount(options, authorization);

      let prepared: PreparedTransaction;
      try {
        prepared = await options.transactions.prepare({
          namespace: EIP155_NAMESPACE,
          chainRef,
          accountId: account.accountId,
          initiator: { type: "dapp", origin },
          transaction: params.transaction,
        });
      } catch (error) {
        if (error instanceof AccountNotFoundError) throw new RpcUnauthorizedError();
        if (
          error instanceof Eip155FeeModelUnsupportedError ||
          error instanceof Eip155PriorityFeeExceedsMaxFeeError ||
          error instanceof Eip155TransactionInvalidError
        ) {
          throw new RpcInvalidParamsError({ message: error.message });
        }
        throw error;
      }

      getAuthorizedAccount(options, authorization);
      const approval = options.approvals.request<"sendTransaction">({
        type: "sendTransaction",
        namespace: EIP155_NAMESPACE,
        origin,
        accountId: account.accountId,
        request: prepared,
      });
      await approval.decision;

      getAuthorizedAccount(options, authorization);
      let submission: TransactionSubmission;
      try {
        submission = await options.transactions.submit(prepared);
      } catch (error) {
        if (error instanceof AccountNotFoundError || error instanceof Eip155TransactionSigningUnavailableError) {
          throw new RpcUnauthorizedError();
        }
        throw error;
      }

      if (submission.status === "failed") {
        throw new RpcJsonRpcResponseError({
          rpcCode: submission.failure.code,
          message: submission.failure.message,
          data: submission.failure.data,
        });
      }
      return submission.transactionHash;
    },
  }),
});
