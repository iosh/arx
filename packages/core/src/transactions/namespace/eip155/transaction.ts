import type { ChainAddressCodecRegistry } from "../../../chains/registry.js";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import { Eip155SubmittedTransactionSchema, Eip155TransactionReceiptSchema } from "../../../storage/schemas.js";
import type {
  Eip155PreparedTransaction,
  Eip155SubmittedTransaction,
  Eip155TransactionReceipt,
  Eip155TransactionRequest,
} from "../../types.js";
import type { NamespaceTransaction } from "../types.js";
import { applyEip155TransactionDraftEdit } from "./applyDraftEdit.js";
import { buildEip155ApprovalReview } from "./approvalReview.js";
import type { Eip155Broadcaster } from "./broadcaster.js";
import { createEip155PrepareTransaction } from "./prepareTransaction.js";
import { createEip155ReceiptService } from "./receipt.js";
import { deriveEip155TransactionRequestForChain } from "./request.js";
import type { Eip155Signer } from "./signer.js";
import type {
  Eip155ApprovalReviewContext,
  Eip155DraftEditContext,
  Eip155PrepareContext,
  Eip155SignContext,
  Eip155TrackingContext,
} from "./types.js";
import { createEip155RequestValidator } from "./validateRequest.js";

type AdapterDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcClient;
  chains: ChainAddressCodecRegistry;
  signer: Pick<Eip155Signer, "signTransaction">;
  broadcaster: Pick<Eip155Broadcaster, "broadcast">;
};

const requireEip155Request = (request: {
  namespace: string;
  payload?: unknown;
  chainRef: string;
}): Eip155TransactionRequest => {
  if (request.namespace !== "eip155") {
    throw new Error(`EIP-155 transaction received namespace "${request.namespace}"`);
  }
  if (!request.payload || typeof request.payload !== "object" || Array.isArray(request.payload)) {
    throw new Error("EIP-155 transaction request requires an object payload");
  }
  return {
    namespace: "eip155",
    chainRef: request.chainRef,
    payload: request.payload as Eip155TransactionRequest["payload"],
  };
};

const requirePreparedHex = (value: `0x${string}` | undefined, label: string): `0x${string}` => {
  if (typeof value !== "string") {
    throw new Error(`EIP-155 broadcast requires ${label}`);
  }
  return value;
};

const buildEip155SubmittedTransaction = (params: {
  hash: `0x${string}`;
  prepared: Eip155PreparedTransaction;
  fallbackFrom: `0x${string}` | string | null;
}): Eip155SubmittedTransaction => {
  const fallbackFrom = typeof params.fallbackFrom === "string" ? (params.fallbackFrom as `0x${string}`) : null;
  const from = params.prepared.from ?? fallbackFrom;
  if (from == null) {
    throw new Error("EIP-155 broadcast requires from address");
  }

  const submitted: Eip155SubmittedTransaction = {
    ...params.prepared,
    hash: params.hash,
    chainId: requirePreparedHex(params.prepared.chainId, "prepared.chainId"),
    from,
    nonce: requirePreparedHex(params.prepared.nonce, "prepared.nonce"),
  };

  return submitted;
};

const deriveEip155ReplacementKey = (params: { chainRef: string; submitted: Eip155SubmittedTransaction }) => {
  return {
    scope: "eip155.nonce",
    value: `${params.chainRef}:${params.submitted.from.toLowerCase()}:${params.submitted.nonce.toLowerCase()}`,
  };
};

export const createEip155Transaction = (deps: AdapterDeps): NamespaceTransaction<"eip155"> => {
  const validateRequest = createEip155RequestValidator({ chains: deps.chains });
  const prepareTransaction = createEip155PrepareTransaction({
    rpcClientFactory: deps.rpcClientFactory,
    chains: deps.chains,
  });
  const receiptService = createEip155ReceiptService({ rpcClientFactory: deps.rpcClientFactory });

  return {
    request: {
      deriveForChain(request, chainRef) {
        return deriveEip155TransactionRequestForChain(requireEip155Request(request), chainRef);
      },
      validateRequest,
    },
    proposal: {
      prepare: (context: Eip155PrepareContext) => prepareTransaction(context),
      buildReview: (context: Eip155ApprovalReviewContext) => buildEip155ApprovalReview(context),
      applyDraftEdit: (context: Eip155DraftEditContext) => applyEip155TransactionDraftEdit(context),
    },
    execution: {
      sign: (context: Eip155SignContext, prepared, options) => deps.signer.signTransaction(context, prepared, options),
      async broadcast(context: Eip155PrepareContext, signed, prepared: Eip155PreparedTransaction) {
        const broadcast = await deps.broadcaster.broadcast(context, signed);
        const txHash = broadcast.hash as `0x${string}`;
        const submitted = buildEip155SubmittedTransaction({
          hash: txHash,
          prepared,
          fallbackFrom: context.from,
        });
        return {
          submitted,
        };
      },
    },
    tracking: {
      fetchReceipt: (context: Eip155TrackingContext) => receiptService.fetchReceipt(context),
      detectReplacement: (context: Eip155TrackingContext) => receiptService.detectReplacement(context),
      deriveReplacementKey(context: Eip155TrackingContext) {
        return deriveEip155ReplacementKey({
          chainRef: context.chainRef,
          submitted: context.submitted,
        });
      },
    },
    record: {
      parseSubmitted(submitted: Eip155SubmittedTransaction) {
        return Eip155SubmittedTransactionSchema.parse(submitted) as Eip155SubmittedTransaction;
      },
      parseReceipt(receipt: Eip155TransactionReceipt) {
        return Eip155TransactionReceiptSchema.parse(receipt) as Eip155TransactionReceipt;
      },
    },
  };
};
