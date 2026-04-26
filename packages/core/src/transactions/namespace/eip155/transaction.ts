import type { ChainAddressCodecRegistry } from "../../../chains/registry.js";
import type { Eip155RpcClient } from "../../../rpc/namespaceClients/eip155.js";
import type { Eip155SubmittedTransaction, Eip155TransactionRequest } from "../../types.js";
import type { NamespaceTransaction } from "../types.js";
import { applyEip155TransactionDraftEdit } from "./applyDraftEdit.js";
import { buildEip155ApprovalReview } from "./approvalReview.js";
import type { Eip155Broadcaster } from "./broadcaster.js";
import { createEip155PrepareTransaction } from "./prepareTransaction.js";
import { createEip155ReceiptService } from "./receipt.js";
import { deriveEip155TransactionRequestForChain } from "./request.js";
import type { Eip155Signer } from "./signer.js";
import type { Eip155PreparedTransaction } from "./types.js";
import { createEip155RequestValidator } from "./validateRequest.js";

type AdapterDeps = {
  rpcClientFactory: (chainRef: string) => Eip155RpcClient;
  chains: ChainAddressCodecRegistry;
  signer: Pick<Eip155Signer, "signTransaction">;
  broadcaster: Pick<Eip155Broadcaster, "broadcast">;
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

export const createEip155Transaction = (deps: AdapterDeps): NamespaceTransaction => {
  const validateRequest = createEip155RequestValidator({ chains: deps.chains });
  const prepareTransaction = createEip155PrepareTransaction({
    rpcClientFactory: deps.rpcClientFactory,
    chains: deps.chains,
  });
  const receiptService = createEip155ReceiptService({ rpcClientFactory: deps.rpcClientFactory });

  return {
    request: {
      deriveForChain(request, chainRef) {
        if (request.namespace !== "eip155") {
          throw new Error(`EIP-155 transaction cannot derive request for namespace "${request.namespace}"`);
        }
        return deriveEip155TransactionRequestForChain(request as Eip155TransactionRequest, chainRef);
      },
      validate: validateRequest,
    },
    proposal: {
      prepare: prepareTransaction,
      buildReview: ({ transaction, request, reviewPreparedSnapshot }) =>
        buildEip155ApprovalReview({
          transaction,
          request,
          ...(reviewPreparedSnapshot !== undefined ? { reviewPreparedSnapshot } : {}),
        }),
      applyDraftEdit: (context) => applyEip155TransactionDraftEdit(context),
    },
    execution: {
      sign: (context, prepared) => deps.signer.signTransaction(context, prepared),
      async broadcast(context, signed, prepared) {
        const broadcast = await deps.broadcaster.broadcast(context, signed);
        const preparedTransaction = prepared as Eip155PreparedTransaction;
        const txHash = broadcast.hash as `0x${string}`;
        const submitted = buildEip155SubmittedTransaction({
          hash: txHash,
          prepared: preparedTransaction,
          fallbackFrom: context.from,
        });
        return {
          submitted,
          locator: {
            format: "eip155.tx_hash",
            value: txHash,
          },
        };
      },
    },
    tracking: {
      fetchReceipt: (context) => receiptService.fetchReceipt(context),
      detectReplacement: (context) => receiptService.detectReplacement(context),
      deriveReplacementKey(context) {
        const submitted = context.submitted as Partial<Eip155SubmittedTransaction>;
        if (typeof submitted.from !== "string" || typeof submitted.nonce !== "string") {
          return null;
        }
        return deriveEip155ReplacementKey({
          chainRef: context.chainRef,
          submitted: submitted as Eip155SubmittedTransaction,
        });
      },
    },
  };
};
