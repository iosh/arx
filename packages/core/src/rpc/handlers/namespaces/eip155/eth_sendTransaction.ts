import { ApprovalKinds } from "../../../../approvals/queue/types.js";
import type { Eip155SubmittedTransaction } from "../../../../transactions/index.js";
import { RpcInternalError, RpcInvalidParamsError } from "../../../errors.js";
import { RpcRequestKinds } from "../../../requestKind.js";
import { lockedQueue } from "../../locked.js";
import { toParamsArray } from "../utils.js";
import { defineEip155AuthorizedAccountApprovalMethod, requestProviderApproval } from "./shared.js";
import { buildEip155TransactionRequest } from "./transactionRequest.js";

type EthSendTransactionParams = readonly [unknown, ...unknown[]];

const isInvalidTransactionIssue = (code: string): boolean => {
  return (
    code === RpcInvalidParamsError.code ||
    code === "transaction.prepare.chain_id_mismatch" ||
    code.startsWith("transaction.prepare.invalid_")
  );
};

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
  executeAuthorizedRequest: async (context) => {
    const { prepared, account, deps, executionContext } = context;

    const proposal = await deps.transactions.prepareTransaction({
      namespace: "eip155",
      chainRef: prepared.chainRef,
      origin: context.origin,
      source: "provider",
      accountId: account.accountId,
      request: {
        payload: prepared.payload,
      },
      replacement: null,
    });

    if (proposal.status !== "ready") {
      const issue = proposal.status === "blocked" ? proposal.blocker : proposal.error;
      const details = {
        code: issue.code,
        ...issue.details,
      };

      if (proposal.status === "blocked" || isInvalidTransactionIssue(issue.code)) {
        throw new RpcInvalidParamsError({
          message: issue.message,
          details,
        });
      }

      throw new RpcInternalError({
        message: issue.message,
        details,
      });
    }

    const approval = requestProviderApproval({
      deps,
      executionContext,
      method: "eth_sendTransaction",
      kind: ApprovalKinds.SendTransaction,
      chainRef: prepared.chainRef,
      request: {
        proposal,
      },
    });

    await approval.settled;

    const result = await deps.transactions.submitTransaction({
      proposal,
    });
    if (result.status === "terminal") {
      const details = {
        code: result.reason.code,
        ...result.reason.details,
      };

      if (result.reason.kind === "validation_failed") {
        throw new RpcInvalidParamsError({
          message: result.reason.message,
          details,
        });
      }

      throw new RpcInternalError({
        message: result.reason.message,
        details,
      });
    }

    const submitted = result.submitted as Eip155SubmittedTransaction;
    return submitted.hash;
  },
});
