import { isApprovalDecisionError } from "../approvals/errors.js";
import type { ChainJsonRpc } from "../chainJsonRpc/ChainJsonRpc.js";
import {
  ChainJsonRpcOutcomeUnknownError,
  ChainJsonRpcResponseError,
  ChainJsonRpcUnavailableError,
} from "../chainJsonRpc/errors.js";
import type { JsonRpcParams } from "../chainJsonRpc/types.js";
import type { Namespace } from "../namespaces/types.js";
import { NetworkNotFoundError } from "../networks/errors.js";
import type { DappRequest, DappRequestMethod } from "./defineDappMethod.js";
import {
  RpcChainUnavailableError,
  RpcJsonRpcResponseError,
  RpcOutcomeUnknownError,
  RpcUnsupportedMethodError,
  RpcUserRejectedRequestError,
} from "./errors.js";

export type DappNamespace = Readonly<{
  namespaceMethods: ReadonlyMap<string, DappRequestMethod>;
  nodeReadMethods: ReadonlySet<string>;
}>;

export type DappNamespaces = Readonly<Record<Namespace, DappNamespace>>;

export const routeDappRequest = async ({
  namespace,
  namespaceRequests,
  chainJsonRpc,
  request,
}: Readonly<{
  namespace: Namespace;
  namespaceRequests: Pick<DappNamespace, "namespaceMethods" | "nodeReadMethods">;
  chainJsonRpc: ChainJsonRpc;
  request: DappRequest;
}>): Promise<unknown> => {
  const namespaceMethod = namespaceRequests.namespaceMethods.get(request.method);
  if (!namespaceMethod && !namespaceRequests.nodeReadMethods.has(request.method)) {
    throw new RpcUnsupportedMethodError({
      message: `Method "${request.method}" is not supported for namespace "${namespace}".`,
    });
  }

  try {
    if (namespaceMethod) return await namespaceMethod(request);

    return await chainJsonRpc.request({
      chainRef: request.chainRef,
      method: request.method,
      ...(request.params === undefined ? {} : { params: request.params as JsonRpcParams }),
      replay: "allowed",
    });
  } catch (error) {
    if (isApprovalDecisionError(error)) {
      throw new RpcUserRejectedRequestError({ message: error.message });
    }

    if (error instanceof ChainJsonRpcResponseError) {
      throw new RpcJsonRpcResponseError({
        rpcCode: error.rpcCode,
        message: error.message,
        data: error.rpcData,
      });
    }

    if (error instanceof ChainJsonRpcUnavailableError || error instanceof NetworkNotFoundError) {
      throw new RpcChainUnavailableError();
    }

    if (error instanceof ChainJsonRpcOutcomeUnknownError) {
      throw new RpcOutcomeUnknownError({ message: "Transaction broadcast outcome is unknown." });
    }

    throw error;
  }
};
