import { ZodError } from "zod";
import type { Namespace } from "../namespaces/types.js";
import type { ChainRef } from "../networks/chainRef.js";
import { RpcInternalError, RpcInvalidParamsError, RpcUnsupportedMethodError } from "../rpc/errors.js";

export type DappRequest = Readonly<{
  origin: string;
  chainRef: ChainRef;
  method: string;
  params?: unknown;
}>;

export type DappRequestMethod = (input: DappRequest) => Promise<unknown>;

export type DappNamespace = Readonly<{
  localMethods: ReadonlyMap<string, DappRequestMethod>;
  nodeReadMethods: ReadonlySet<string>;
  forwardNodeRead(input: DappRequest): Promise<unknown>;
}>;

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

export const routeDappRequest = async (
  namespace: Namespace,
  namespaces: ReadonlyMap<Namespace, DappNamespace>,
  input: DappRequest,
): Promise<unknown> => {
  const namespaceRequests = namespaces.get(namespace);
  if (!namespaceRequests) throw unsupportedMethod(namespace, input.method);

  const localMethod = namespaceRequests.localMethods.get(input.method);
  if (localMethod) return localMethod(input);

  if (namespaceRequests.nodeReadMethods.has(input.method)) return namespaceRequests.forwardNodeRead(input);

  throw unsupportedMethod(namespace, input.method);
};
