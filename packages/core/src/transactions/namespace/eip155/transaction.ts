import * as Hex from "ox/Hex";
import type { ChainJsonRpcClient } from "../../../chainJsonRpc/ChainJsonRpc.js";
import type { ChainAddressingByNamespace } from "../../../chains/addressing.js";
import type { Eip155TransactionRequest } from "../../types.js";
import type { NamespaceTransaction } from "../types.js";
import { buildEip155ApprovalReview } from "./approvalReview.js";
import type { Eip155Broadcaster } from "./broadcaster.js";
import { createEip155FeeOracle } from "./feeOracle.js";
import { createEip155PrepareTransaction } from "./prepareTransaction.js";
import { createEip155ReceiptService } from "./receipt.js";
import { deriveEip155TransactionRequestForChain } from "./request.js";
import type { Eip155Signer } from "./signer.js";
import type { Eip155SubmittedTransaction, Eip155TransactionPayload } from "./transactionTypes.js";
import type {
  Eip155ApprovalReviewContext,
  Eip155FinalizeSubmitContext,
  Eip155FinalizeSubmitResult,
  Eip155PrepareContext,
  Eip155ReplacementRequestContext,
} from "./types.js";
import {
  buildEip155TransactionConflictKey,
  type Eip155PreparedTransaction,
  type Eip155UnsignedTransaction,
} from "./unsignedTransaction.js";
import { createEip155RequestValidator } from "./validateRequest.js";

type AdapterDeps = {
  chainJsonRpc: ChainJsonRpcClient;
  chains: ChainAddressingByNamespace;
  signer: Pick<Eip155Signer, "signTransaction">;
  broadcaster: Pick<Eip155Broadcaster, "broadcast">;
};

export const EIP155_INITIAL_INSPECTION_DELAY_MS = 3_000;
export const EIP155_PENDING_INSPECTION_DELAY_MS = 12_000;
export const EIP155_RETRY_BASE_DELAY_MS = 5_000;
export const EIP155_RETRY_MAX_DELAY_MS = 60_000;
const EIP155_CANCEL_GAS_LIMIT: Hex.Hex = "0x5208";
const REPLACEMENT_FEE_BUMP_NUMERATOR = 11n;
const REPLACEMENT_FEE_BUMP_DENOMINATOR = 10n;

const buildEip155SubmittedTransaction = (params: {
  hash: `0x${string}`;
  transaction: Eip155UnsignedTransaction;
}): Eip155SubmittedTransaction => {
  const { type: _type, ...submittedFields } = params.transaction;
  return {
    hash: params.hash,
    ...submittedFields,
  };
};

const raiseReplacementFee = (fee: Hex.Hex): Hex.Hex => {
  const scaled = Hex.toBigInt(fee) * REPLACEMENT_FEE_BUMP_NUMERATOR;
  const quotient = scaled / REPLACEMENT_FEE_BUMP_DENOMINATOR;
  const roundedUp = scaled % REPLACEMENT_FEE_BUMP_DENOMINATOR === 0n ? quotient : quotient + 1n;
  return Hex.fromNumber(roundedUp) as Hex.Hex;
};

const higherFee = (left: Hex.Hex, right: Hex.Hex): Hex.Hex =>
  Hex.toBigInt(left) >= Hex.toBigInt(right) ? left : right;

const priceReplacementFees = async (
  transaction: Eip155UnsignedTransaction,
  chainRef: string,
  deps: Pick<AdapterDeps, "chainJsonRpc">,
): Promise<Pick<Eip155TransactionPayload, "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas">> => {
  if (transaction.type === "legacy") {
    const raisedGasPrice = raiseReplacementFee(transaction.gasPrice);
    const latestGasPrice = await deps.chainJsonRpc
      .request<Hex.Hex>({ chainRef, method: "eth_gasPrice" })
      .catch(() => null);
    return {
      gasPrice: latestGasPrice === null ? raisedGasPrice : higherFee(raisedGasPrice, latestGasPrice as `0x${string}`),
    };
  }

  const raisedMaxFeePerGas = raiseReplacementFee(transaction.maxFeePerGas);
  const raisedMaxPriorityFeePerGas = raiseReplacementFee(transaction.maxPriorityFeePerGas);
  const suggestion = await createEip155FeeOracle({ chainJsonRpc: deps.chainJsonRpc, chainRef })
    .suggestFees()
    .catch(() => null);
  if (suggestion?.mode !== "eip1559") {
    return {
      maxFeePerGas: raisedMaxFeePerGas,
      maxPriorityFeePerGas: raisedMaxPriorityFeePerGas,
    };
  }

  return {
    maxFeePerGas: higherFee(raisedMaxFeePerGas, suggestion.maxFeePerGas),
    maxPriorityFeePerGas: higherFee(raisedMaxPriorityFeePerGas, suggestion.maxPriorityFeePerGas),
  };
};

export const createEip155ReplacementRequest = async (
  context: Eip155ReplacementRequestContext,
  deps: Pick<AdapterDeps, "chainJsonRpc">,
): Promise<Eip155TransactionRequest> => {
  const target = context.targetApprovedPayload;
  const fees = await priceReplacementFees(target, context.chainRef, deps);
  const payload: Eip155TransactionPayload = {
    chainId: target.chainId,
    from: target.from,
    to: context.type === "cancel" ? target.from : target.to,
    value: context.type === "cancel" ? "0x0" : target.value,
    data: context.type === "cancel" ? "0x" : target.data,
    gas: context.type === "cancel" ? EIP155_CANCEL_GAS_LIMIT : target.gas,
    nonce: target.nonce,
    ...fees,
  };

  return {
    namespace: "eip155",
    chainRef: context.chainRef,
    payload,
  };
};

const approvePreparedTransaction = (
  preparedPayload: Eip155PreparedTransaction,
  nonce: Hex.Hex,
): Eip155UnsignedTransaction => ({
  ...preparedPayload,
  nonce,
});

const isReplacingSubmittedNonce = (context: Eip155FinalizeSubmitContext, nonce: `0x${string}`): boolean => {
  const replacement = context.replacement;
  if (!replacement) {
    return false;
  }

  const replaced = context.localActiveTransactions.find(
    (transaction) => transaction.transactionId === replacement.transactionId,
  );
  if (!replaced || replaced.status !== "submitted") {
    return false;
  }

  return replaced.approvedPayload.nonce === nonce;
};

const findBlockingLocalNonceConflicts = (context: Eip155FinalizeSubmitContext, nonce: `0x${string}`): string[] => {
  const replacingSubmittedNonce = isReplacingSubmittedNonce(context, nonce);

  return context.localActiveTransactions
    .filter((transaction) => transaction.approvedPayload.nonce === nonce)
    .filter((transaction) => {
      return !(replacingSubmittedNonce && transaction.status === "submitted");
    })
    .map((transaction) => transaction.transactionId);
};

const deriveLocalNextNonce = (context: Eip155FinalizeSubmitContext): `0x${string}` | null => {
  let maxNonce: bigint | null = null;

  for (const transaction of context.localActiveTransactions) {
    const nonce = transaction.approvedPayload.nonce;
    const numericNonce = Hex.toBigInt(nonce);
    maxNonce = maxNonce === null || numericNonce > maxNonce ? numericNonce : maxNonce;
  }

  return maxNonce === null ? null : (Hex.fromNumber(maxNonce + 1n) as `0x${string}`);
};

export const finalizeEip155Submit = async (
  context: Eip155FinalizeSubmitContext,
  deps: Pick<AdapterDeps, "chainJsonRpc">,
): Promise<Eip155FinalizeSubmitResult> => {
  const pendingNonce = await deps.chainJsonRpc.request<`0x${string}`>({
    chainRef: context.chainRef,
    method: "eth_getTransactionCount",
    params: [context.from, "pending"],
  });
  const preparedPayload = context.preparedPayload;

  if (preparedPayload.nonce === undefined) {
    const localNextNonce = deriveLocalNextNonce(context);
    const finalNonce =
      localNextNonce === null || Hex.toBigInt(localNextNonce) <= Hex.toBigInt(pendingNonce)
        ? pendingNonce
        : localNextNonce;
    const approvedPayload = approvePreparedTransaction(preparedPayload, finalNonce);
    return {
      status: "approved",
      approvedPayload,
      conflictKey: buildEip155TransactionConflictKey({
        chainRef: context.chainRef,
        accountId: context.accountId,
        nonce: approvedPayload.nonce,
      }),
    };
  }

  const approvedPayload = approvePreparedTransaction(preparedPayload, preparedPayload.nonce);
  const approvedNonce = Hex.toBigInt(approvedPayload.nonce);
  const latestPendingNonce = BigInt(pendingNonce);
  const blockingLocalConflicts = findBlockingLocalNonceConflicts(context, approvedPayload.nonce);
  if (blockingLocalConflicts.length > 0) {
    return {
      status: "blocked",
      blocker: {
        code: "transaction.submit.nonce_conflict",
        message: "Another local transaction is already using this nonce.",
        details: {
          nonce: approvedPayload.nonce,
          conflictingTransactionIds: blockingLocalConflicts,
        },
      },
      reviewSnapshot: null,
    };
  }

  if (approvedNonce < latestPendingNonce && !isReplacingSubmittedNonce(context, approvedPayload.nonce)) {
    return {
      status: "blocked",
      blocker: {
        code: "transaction.submit.nonce_already_used",
        message: "The requested nonce is already below the network pending nonce.",
        details: {
          nonce: approvedPayload.nonce,
          pendingNonce,
        },
      },
      reviewSnapshot: null,
    };
  }

  return {
    status: "approved",
    approvedPayload,
    conflictKey: buildEip155TransactionConflictKey({
      chainRef: context.chainRef,
      accountId: context.accountId,
      nonce: approvedPayload.nonce,
    }),
  };
};

export const createEip155Transaction = (deps: AdapterDeps): NamespaceTransaction<"eip155"> => {
  const validateRequest = createEip155RequestValidator({ chains: deps.chains });
  const prepareTransaction = createEip155PrepareTransaction({
    chainJsonRpc: deps.chainJsonRpc,
    chains: deps.chains,
  });
  const receiptService = createEip155ReceiptService({ chainJsonRpc: deps.chainJsonRpc });

  return {
    request: {
      deriveForChain(request, chainRef) {
        return deriveEip155TransactionRequestForChain(request, chainRef);
      },
      validateRequest,
    },
    proposal: {
      prepare: (context: Eip155PrepareContext) => prepareTransaction(context),
      buildReview: (context: Eip155ApprovalReviewContext) => buildEip155ApprovalReview(context),
      buildReplacementRequest: (context: Eip155ReplacementRequestContext) =>
        createEip155ReplacementRequest(context, deps),
      deriveResourceKey(context) {
        return {
          kind: "eip155.account_nonce",
          value: `${context.chainRef}:${context.accountId}`,
        };
      },
      finalizeSubmit: (context: Eip155FinalizeSubmitContext) => finalizeEip155Submit(context, deps),
    },
    submission: {
      async createBroadcastArtifact(context, options) {
        const signed = await deps.signer.signTransaction(
          {
            namespace: "eip155",
            chainRef: context.chainRef,
            origin: context.origin,
            from: context.from,
            request: context.request,
          },
          context.approvedPayload,
          options,
        );

        return {
          kind: "eip155.raw_transaction",
          payload: {
            raw: signed.raw,
          },
        };
      },
      async broadcast(context) {
        const broadcast = await deps.broadcaster.broadcast(
          {
            namespace: "eip155",
            chainRef: context.chainRef,
            origin: context.origin,
            from: context.from,
            request: context.request,
          },
          context.broadcastArtifact.payload,
        );
        const txHash = broadcast.hash as `0x${string}`;
        const submitted = buildEip155SubmittedTransaction({
          hash: txHash,
          transaction: context.approvedPayload,
        });

        return {
          broadcastIdentity: { hash: txHash },
          submitted,
        };
      },
    },
    tracking: {
      inspectSubmittedTransaction: (context) => receiptService.inspectSubmittedTransaction(context),
      getInitialInspectionDelay: () => EIP155_INITIAL_INSPECTION_DELAY_MS,
      getPendingInspectionDelay: () => EIP155_PENDING_INSPECTION_DELAY_MS,
      getRetryInspectionDelay: (context) =>
        Math.min(EIP155_RETRY_MAX_DELAY_MS, EIP155_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, context.attempt - 1)),
    },
  };
};
