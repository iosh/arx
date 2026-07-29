import { ZodError } from "zod";
import { ChainJsonRpcResponseError, ChainJsonRpcUnavailableError } from "../chainJsonRpc/errors.js";
import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "../networks/chainRef.js";
import { parseChainRef } from "../networks/chainRef.js";
import { NetworkNotFoundError } from "../networks/errors.js";
import {
  RpcChainUnavailableError,
  RpcInternalError,
  RpcInvalidParamsError,
  RpcJsonRpcResponseError,
  RpcUnsupportedMethodError,
} from "../rpc/errors.js";

export type DappRequest = Readonly<{
  origin: string;
  chainRef: ChainRef;
  method: string;
  params?: unknown;
}>;

export type DappRequestMethod = (input: DappRequest) => Promise<unknown>;

export type NodeReadRequest = Readonly<{
  chainRef: ChainRef;
  method: string;
  params?: unknown;
}>;

export type DappNamespace = Readonly<{
  namespaceMethods: ReadonlyMap<string, DappRequestMethod>;
  nodeReadMethods: ReadonlySet<string>;
  forwardNodeRead(input: NodeReadRequest): Promise<unknown>;
}>;

export type DappNamespaces = Readonly<Record<Namespace, DappNamespace | undefined>>;

export const invalidDappParams = (method: string, reason: string): RpcInvalidParamsError =>
  new RpcInvalidParamsError({ message: `${method}: ${reason}` });

type DappMethodDefinition<Params> = Readonly<{
  decode(params: unknown, method: string): Params;
  execute(input: Readonly<{ origin: string; chainRef: ChainRef; params: Params }>): Promise<unknown>;
}>;

export const decodeDappParams = <Params>(
  params: unknown,
  method: string,
  decode: (params: unknown, method: string) => Params,
): Params => {
  try {
    return decode(params, method);
  } catch (error) {
    if (error instanceof RpcInvalidParamsError) throw error;

    if (error instanceof ZodError) {
      throw new RpcInvalidParamsError({
        message: `Invalid params for "${method}".`,
      });
    }

    throw new RpcInternalError({
      message: `Failed to decode params for "${method}".`,
      cause: error,
    });
  }
};

export const defineDappMethod = <Params>(definition: DappMethodDefinition<Params>): DappRequestMethod => {
  return async (input) => {
    const params = decodeDappParams(input.params, input.method, definition.decode);
    return definition.execute({
      origin: input.origin,
      chainRef: input.chainRef,
      params,
    });
  };
};

export const decodeNoParams = (params: unknown, method: string): undefined => {
  if (params === undefined || params === null) return undefined;
  if (Array.isArray(params) && params.length === 0) return undefined;

  throw new RpcInvalidParamsError({
    message: `Method "${method}" does not accept params.`,
  });
};

const unsupportedMethod = (namespace: Namespace, method: string): RpcUnsupportedMethodError => {
  return new RpcUnsupportedMethodError({
    message: `Method "${method}" is not supported for namespace "${namespace}".`,
  });
};

const forwardNodeRead = async (namespaceRequests: DappNamespace, input: NodeReadRequest): Promise<unknown> => {
  try {
    return await namespaceRequests.forwardNodeRead(input);
  } catch (error) {
    if (error instanceof RpcInvalidParamsError) throw error;

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

    throw new RpcInternalError({
      message: "Unable to complete the chain RPC request.",
      cause: error,
    });
  }
};

export const routeDappRequest = async (
  namespace: Namespace,
  namespaces: DappNamespaces,
  input: DappRequest,
): Promise<unknown> => {
  const namespaceRequests = namespaces[namespace];
  if (!namespaceRequests) throw unsupportedMethod(namespace, input.method);

  const namespaceMethod = namespaceRequests.namespaceMethods.get(input.method);
  if (namespaceMethod) return namespaceMethod(input);

  if (namespaceRequests.nodeReadMethods.has(input.method)) return forwardNodeRead(namespaceRequests, input);

  throw unsupportedMethod(namespace, input.method);
};

export const routeChainRpcRequest = async (namespaces: DappNamespaces, input: NodeReadRequest): Promise<unknown> => {
  const { namespace } = parseChainRef(input.chainRef);
  const namespaceRequests = namespaces[namespace];
  if (!namespaceRequests?.nodeReadMethods.has(input.method)) throw unsupportedMethod(namespace, input.method);

  return forwardNodeRead(namespaceRequests, input);
};
