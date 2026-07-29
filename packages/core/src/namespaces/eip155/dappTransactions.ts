import type { Accounts } from "../../accounts/Accounts.js";
import { AccountNotFoundError } from "../../accounts/errors.js";
import type { Approvals } from "../../approvals/Approvals.js";
import { isApprovalDecisionError } from "../../approvals/errors.js";
import { ChainJsonRpcResponseError, ChainJsonRpcUnavailableError } from "../../chainJsonRpc/errors.js";
import { type DappRequestMethod, defineDappMethod, invalidDappParams } from "../../dappConnections/routeDappRequest.js";
import { NetworkNotFoundError } from "../../networks/errors.js";
import type { PermissionsReader } from "../../permissions/Permissions.js";
import {
  RpcChainUnavailableError,
  RpcInternalError,
  RpcInvalidParamsError,
  RpcJsonRpcResponseError,
  RpcUnauthorizedError,
  RpcUserRejectedRequestError,
} from "../../rpc/errors.js";
import {
  Eip155FeeModelUnsupportedError,
  Eip155PriorityFeeExceedsMaxFeeError,
  Eip155TransactionInvalidError,
  Eip155TransactionSigningUnavailableError,
} from "../../transactions/eip155/errors.js";
import type { PreparedTransaction } from "../../transactions/preparedTransaction.js";
import type { Transactions } from "../../transactions/Transactions.js";
import type { TransactionSubmission } from "../../transactions/types.js";
import { EIP155_NAMESPACE } from "./constants.js";
import { getAuthorizedAccount } from "./dappAccount.js";
import { decodeSendTransactionParams } from "./transactionRequest.js";

type CreateEip155DappTransactionHandlersOptions = Readonly<{
  accounts: Pick<Accounts, "accountIdFromAddress" | "getAccount" | "getAddress">;
  permissions: Pick<PermissionsReader, "get">;
  approvals: Pick<Approvals, "request">;
  transactions: Pick<Transactions, "prepare" | "submit">;
}>;

const createJsonRpcResponseError = (error: ChainJsonRpcResponseError): RpcJsonRpcResponseError =>
  new RpcJsonRpcResponseError({
    rpcCode: error.rpcCode,
    message: error.message,
    data: error.rpcData,
  });

const mapTransactionPreparationError = (error: unknown): Error => {
  if (error instanceof AccountNotFoundError) return new RpcUnauthorizedError();
  if (error instanceof ChainJsonRpcResponseError) return createJsonRpcResponseError(error);
  if (error instanceof ChainJsonRpcUnavailableError || error instanceof NetworkNotFoundError) {
    return new RpcChainUnavailableError();
  }
  if (
    error instanceof Eip155FeeModelUnsupportedError ||
    error instanceof Eip155PriorityFeeExceedsMaxFeeError ||
    error instanceof Eip155TransactionInvalidError
  ) {
    return new RpcInvalidParamsError({ message: error.message });
  }

  return new RpcInternalError({
    message: "Unable to prepare the EIP-155 transaction.",
    cause: error,
  });
};

const mapTransactionSubmissionError = (error: unknown): Error => {
  if (error instanceof AccountNotFoundError || error instanceof Eip155TransactionSigningUnavailableError) {
    return new RpcUnauthorizedError();
  }
  if (error instanceof ChainJsonRpcResponseError) return createJsonRpcResponseError(error);
  if (error instanceof ChainJsonRpcUnavailableError || error instanceof NetworkNotFoundError) {
    return new RpcChainUnavailableError();
  }

  return new RpcInternalError({
    message: "Unable to submit the EIP-155 transaction.",
    cause: error,
  });
};

export const createEip155DappTransactionHandlers = (
  options: CreateEip155DappTransactionHandlersOptions,
): Readonly<{ sendTransaction: DappRequestMethod }> => ({
  sendTransaction: defineDappMethod({
    decode: decodeSendTransactionParams,
    execute: async ({ origin, chainRef, params }) => {
      if (params.requestedChainRef !== undefined && params.requestedChainRef !== chainRef) {
        throw invalidDappParams("eth_sendTransaction", "chainId must match the active chain.");
      }

      const account = getAuthorizedAccount(options, {
        origin,
        chainRef,
        address: params.from,
      });

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
        throw mapTransactionPreparationError(error);
      }

      const approval = options.approvals.request<"sendTransaction">({
        type: "sendTransaction",
        namespace: EIP155_NAMESPACE,
        origin,
        request: prepared,
      });
      try {
        await approval.decision;
      } catch (error) {
        if (isApprovalDecisionError(error)) {
          throw new RpcUserRejectedRequestError({ message: error.message });
        }
        throw new RpcInternalError({
          message: "Unable to complete the transaction approval.",
          cause: error,
        });
      }

      let submission: TransactionSubmission;
      try {
        submission = await options.transactions.submit(prepared);
      } catch (error) {
        throw mapTransactionSubmissionError(error);
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
