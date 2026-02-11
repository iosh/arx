import { ArxReasons, arxError } from "@arx/errors";
import type { TransactionController, TransactionMeta } from "../../../../controllers/index.js";
import type { RpcInvocationContext } from "../../types.js";

export const requireRequestContext = (rpcContext: RpcInvocationContext | undefined, method: string) => {
  const requestContext = rpcContext?.requestContext;
  if (!requestContext) {
    throw arxError({
      reason: ArxReasons.RpcInvalidRequest,
      message: `Missing request context for ${method}.`,
      data: { method },
    });
  }
  return requestContext;
};

export class TransactionResolutionError extends Error {
  readonly meta: TransactionMeta;

  constructor(meta: TransactionMeta) {
    super(meta.error?.message ?? "Transaction failed");
    this.name = "TransactionResolutionError";
    this.meta = meta;
  }
}

const RESOLVED_STATUSES = new Set<TransactionMeta["status"]>(["broadcast", "confirmed"]);
const FAILED_STATUSES = new Set<TransactionMeta["status"]>(["failed", "replaced"]);

const isResolved = (meta: TransactionMeta) => RESOLVED_STATUSES.has(meta.status) && typeof meta.hash === "string";
const isFailed = (meta: TransactionMeta) => FAILED_STATUSES.has(meta.status);

export const waitForTransactionBroadcast = async (
  controller: Pick<TransactionController, "getMeta" | "onStatusChanged">,
  id: string,
): Promise<TransactionMeta> => {
  const initial = controller.getMeta(id);
  if (!initial) {
    throw new Error(`Transaction ${id} not found after submission`);
  }
  if (isResolved(initial)) {
    return initial;
  }
  if (isFailed(initial)) {
    throw new TransactionResolutionError(initial);
  }

  return new Promise<TransactionMeta>((resolve, reject) => {
    const unsubscribe = controller.onStatusChanged(({ id: changeId, meta }) => {
      if (changeId !== id) {
        return;
      }

      if (isResolved(meta)) {
        unsubscribe();
        resolve(meta);
        return;
      }

      if (isFailed(meta)) {
        unsubscribe();
        reject(new TransactionResolutionError(meta));
      }
    });
  });
};

export const isTransactionResolutionError = (error: unknown): error is TransactionResolutionError =>
  error instanceof TransactionResolutionError;
