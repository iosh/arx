import { ZodError, type z } from "zod";
import { RpcInvalidParamsError, RpcUnsupportedMethodError } from "../rpc/errors.js";
import { WalletOperationBindingInvariantError } from "./errors.js";
import {
  isWalletOperation,
  type WalletOperation,
  type WalletOperationInputAtPath,
  type WalletOperationPath,
  type WalletOperationResultAtPath,
  type WalletOperations,
} from "./operation.js";

export type WalletOperationHandler<TContext, TOperation extends WalletOperation> = (
  context: TContext,
  input: z.output<TOperation["input"]>,
) => TOperation extends WalletOperation<z.ZodTypeAny, infer TResult> ? TResult | Promise<TResult> : never;

export type WalletOperationHandlerTree<TContext, TOperations extends WalletOperations> = Readonly<{
  [K in keyof TOperations]: TOperations[K] extends WalletOperation
    ? WalletOperationHandler<TContext, TOperations[K]>
    : TOperations[K] extends WalletOperations
      ? WalletOperationHandlerTree<TContext, TOperations[K]>
      : never;
}>;

type WalletOperationBinding<TContext> = {
  operation: WalletOperation;
  handler: WalletOperationHandler<TContext, WalletOperation>;
};

export type WalletOperationExecutor<TOperations extends WalletOperations> = Readonly<{
  executePath<TPath extends WalletOperationPath<TOperations>>(
    path: TPath,
    input: WalletOperationInputAtPath<TOperations, TPath>,
  ): Promise<WalletOperationResultAtPath<TOperations, TPath>>;
  executeUnknownPath(path: string, input: unknown): Promise<unknown>;
}>;

const bindWalletOperations = <TContext, TOperations extends WalletOperations>(
  operations: TOperations,
  handlers: WalletOperationHandlerTree<TContext, TOperations>,
) => {
  const bindingsByPath = new Map<string, WalletOperationBinding<TContext>>();

  const bindNode = (operationBranch: WalletOperations, handlerNode: unknown, segments: string[]) => {
    for (const [key, childNode] of Object.entries(operationBranch)) {
      const pathSegments = [...segments, key];
      const path = pathSegments.join(".");
      const childHandler = (handlerNode as Record<string, unknown> | null | undefined)?.[key];

      if (isWalletOperation(childNode)) {
        if (typeof childHandler !== "function") {
          throw new WalletOperationBindingInvariantError({
            path,
            message: `Wallet operation "${path}" is missing a handler implementation.`,
          });
        }

        bindingsByPath.set(path, {
          operation: childNode,
          handler: childHandler as WalletOperationHandler<TContext, WalletOperation>,
        });
        continue;
      }

      bindNode(childNode, childHandler, pathSegments);
    }
  };

  bindNode(operations, handlers, []);

  return bindingsByPath;
};

export const createWalletOperationExecutor = <TContext, TOperations extends WalletOperations>(deps: {
  context: TContext;
  operations: TOperations;
  handlers: WalletOperationHandlerTree<TContext, TOperations>;
}): WalletOperationExecutor<TOperations> => {
  const bindingsByPath = bindWalletOperations(deps.operations, deps.handlers);

  const requireBinding = (path: string): WalletOperationBinding<TContext> => {
    const binding = bindingsByPath.get(path);
    if (!binding) {
      throw new RpcUnsupportedMethodError({ message: `Unsupported wallet operation: ${path}` });
    }
    return binding;
  };

  const executeUnknownPath = async (path: string, input: unknown): Promise<unknown> => {
    const binding = requireBinding(path);
    let params: unknown;
    try {
      params = binding.operation.input.parse(input);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new RpcInvalidParamsError({
          message: `Invalid params for wallet operation: ${path}`,
          cause: error,
        });
      }
      throw error;
    }
    return binding.handler(deps.context, params);
  };

  return {
    executePath: executeUnknownPath as <TPath extends WalletOperationPath<TOperations>>(
      path: TPath,
      input: WalletOperationInputAtPath<TOperations, TPath>,
    ) => Promise<WalletOperationResultAtPath<TOperations, TPath>>,
    executeUnknownPath,
  } as WalletOperationExecutor<TOperations>;
};
