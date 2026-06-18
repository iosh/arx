import { ApprovalRejectedError } from "../../../../approvals/errors.js";
import { TransportDisconnectedError } from "../../../../runtime/provider/errors.js";
import { buildTransactionTerminalReason, type JsonValue } from "../../../../transactions/aggregate/index.js";
import type { Eip155SubmittedTransaction } from "../../../../transactions/index.js";
import { RpcInternalError, RpcInvalidParamsError } from "../../../errors.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { toParamsArray } from "../utils.js";
import {
  defineEip155AuthorizedAccountApprovalMethod,
  requireProviderRequestHandle,
  requireRequestContext,
} from "./shared.js";
import { buildEip155TransactionRequest } from "./transactionRequest.js";

type EthSendTransactionParams = readonly [unknown, ...unknown[]];

const ETH_SEND_TRANSACTION_REQUEST_KIND = "eip155.rpc.eth_sendTransaction";

export const ethSendTransactionDefinition = defineEip155AuthorizedAccountApprovalMethod({
  requestKind: RpcRequestKinds.TransactionSubmission,
  locked: lockedQueue(),
  parseParams: (params) => {
    const paramsArray = toParamsArray(params);

    if (paramsArray.length === 0) {
      throw new RpcInvalidParamsError({
        message: "eth_sendTransaction requires at least one transaction parameter",
      });
    }

    return paramsArray as unknown as EthSendTransactionParams;
  },
  buildAuthorizedExecution: ({ params, invocation }) => {
    const txRequest = buildEip155TransactionRequest(params, invocation.chainRef);
    return {
      address: txRequest.payload.from,
      prepared: txRequest,
    };
  },
  executeAuthorizedRequest: async ({ origin, prepared, account, services, executionContext }) => {
    const requestContext = requireRequestContext(executionContext, "eth_sendTransaction");
    const providerRequestHandle = requireProviderRequestHandle(executionContext, "eth_sendTransaction");

    const { decision } = await providerRequestHandle.attachBlockingApproval(({ approvalId }) =>
      services.transactions.requestTransactionApproval({
        namespace: "eip155",
        chainRef: prepared.chainRef,
        origin,
        source: "provider",
        requestId: requestContext.requestId,
        accountKey: account.accountKey,
        approvalId,
        cancellation: {
          signal: providerRequestHandle.signal,
          reason: buildTransactionTerminalReason({
            kind: "approval_cancelled",
            code: "provider.caller_disconnected",
            message: "Provider caller disconnected before transaction approval completed.",
            details: { reason: "caller_disconnected" },
          }),
        },
        request: {
          kind: ETH_SEND_TRANSACTION_REQUEST_KIND,
          payload: prepared.payload as JsonValue,
        },
      }),
    );

    const approvalDecision = await decision;
    if (approvalDecision.status === "rejected") {
      throw new ApprovalRejectedError({
        message: approvalDecision.reason?.message ?? "Transaction approval was rejected.",
      });
    }
    if (approvalDecision.status === "cancelled") {
      if (approvalDecision.reason?.code === "provider.caller_disconnected") {
        throw new TransportDisconnectedError({
          message: approvalDecision.reason.message,
        });
      }
      throw new RpcInternalError({
        message: approvalDecision.reason?.message ?? "Transaction approval was cancelled.",
      });
    }

    const outcome = await services.transactions.waitForTransactionSubmissionOutcome({
      transactionId: approvalDecision.transaction.id,
      signal: providerRequestHandle.signal,
    });
    if (outcome.kind === "terminal") {
      const reason = outcome.transaction.terminalReason;
      if (outcome.transaction.status === "cancelled" && reason?.code === "provider.caller_disconnected") {
        throw new TransportDisconnectedError({
          message: reason.message,
        });
      }
      throw new RpcInternalError({
        message: reason?.message ?? "Transaction submission failed",
      });
    }

    const submitted = outcome.submitted as Eip155SubmittedTransaction;
    return submitted.hash;
  },
});
