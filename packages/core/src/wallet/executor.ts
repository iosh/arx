import { ZodError, type z } from "zod";
import { RpcInvalidParamsError, RpcUnsupportedMethodError } from "../rpc/errors.js";
import {
  isWalletOperationDescriptor,
  type WalletOperationDescriptor,
  type WalletOperationDescriptorTree,
  type WalletOperationPath,
} from "./operation.js";

export type WalletOperationHandler<TContext, TOperation extends WalletOperationDescriptor> = (
  context: TContext,
  input: z.output<TOperation["input"]>,
) => unknown;

export type WalletOperationHandlerTree<TContext, TOperations extends WalletOperationDescriptorTree> = Readonly<{
  [K in keyof TOperations]: TOperations[K] extends WalletOperationDescriptor
    ? WalletOperationHandler<TContext, TOperations[K]>
    : TOperations[K] extends WalletOperationDescriptorTree
      ? WalletOperationHandlerTree<TContext, TOperations[K]>
      : never;
}>;

type WalletOperationBinding<TContext> = {
  descriptor: WalletOperationDescriptor;
  handler: WalletOperationHandler<TContext, WalletOperationDescriptor>;
};

type WalletOperationDescriptorAtPath<
  TOperations extends WalletOperationDescriptorTree,
  TPath extends string,
> = TPath extends `${infer THead}.${infer TRest}`
  ? THead extends keyof TOperations
    ? TOperations[THead] extends WalletOperationDescriptorTree
      ? WalletOperationDescriptorAtPath<TOperations[THead], TRest>
      : never
    : never
  : TPath extends keyof TOperations
    ? TOperations[TPath] extends WalletOperationDescriptor
      ? TOperations[TPath]
      : never
    : never;

type WalletOperationHandlerAtPath<THandlers, TPath extends string> = TPath extends `${infer THead}.${infer TRest}`
  ? THead extends keyof THandlers
    ? WalletOperationHandlerAtPath<THandlers[THead], TRest>
    : never
  : TPath extends keyof THandlers
    ? THandlers[TPath]
    : never;

export type WalletOperationInputAtPath<
  TOperations extends WalletOperationDescriptorTree,
  TPath extends WalletOperationPath<TOperations>,
> =
  WalletOperationDescriptorAtPath<TOperations, TPath> extends WalletOperationDescriptor<infer TInputSchema>
    ? z.input<TInputSchema>
    : never;

export type WalletOperationResultAtPath<THandlers, TPath extends string> =
  WalletOperationHandlerAtPath<THandlers, TPath> extends (...args: never[]) => infer TResult ? TResult : never;

export type WalletOperationExecutor<
  TContext,
  TOperations extends WalletOperationDescriptorTree,
  THandlers extends WalletOperationHandlerTree<TContext, TOperations>,
> = Readonly<{
  executePath<TPath extends WalletOperationPath<TOperations>>(
    path: TPath,
    input: WalletOperationInputAtPath<TOperations, TPath>,
  ): WalletOperationResultAtPath<THandlers, TPath>;
  executeUnknownPath(path: string, input: unknown): unknown;
}>;

const buildWalletOperationBindingsByPath = <TContext, TOperations extends WalletOperationDescriptorTree>(
  operations: TOperations,
  handlers: WalletOperationHandlerTree<TContext, TOperations>,
) => {
  const bindingsByPath = new Map<string, WalletOperationBinding<TContext>>();

  const visitNode = (operationNode: WalletOperationDescriptorTree, handlerNode: unknown, segments: string[]) => {
    for (const [key, childOperation] of Object.entries(operationNode)) {
      const childHandler = (handlerNode as Record<string, unknown> | null | undefined)?.[key];
      const nextSegments = [...segments, key];

      if (isWalletOperationDescriptor(childOperation)) {
        if (typeof childHandler !== "function") {
          throw new Error(`Wallet operation "${nextSegments.join(".")}" is missing a handler implementation.`);
        }

        const path = nextSegments.join(".");
        const binding = {
          descriptor: childOperation,
          handler: childHandler as WalletOperationHandler<TContext, WalletOperationDescriptor>,
        };
        bindingsByPath.set(path, binding);
        continue;
      }

      visitNode(childOperation, childHandler, nextSegments);
    }
  };

  visitNode(operations, handlers, []);
  return bindingsByPath;
};

export const createWalletOperationExecutor = <
  TContext,
  TOperations extends WalletOperationDescriptorTree,
  THandlers extends WalletOperationHandlerTree<TContext, TOperations>,
>(deps: {
  context: TContext;
  operations: TOperations;
  handlers: THandlers;
}): WalletOperationExecutor<TContext, TOperations, THandlers> => {
  const bindingsByPath = buildWalletOperationBindingsByPath(deps.operations, deps.handlers);

  const requireBinding = (path: string): WalletOperationBinding<TContext> => {
    const binding = bindingsByPath.get(path);
    if (!binding) {
      throw new RpcUnsupportedMethodError({ message: `Unsupported wallet operation: ${path}` });
    }
    return binding;
  };

  const executeUnknownPath = (path: string, input: unknown): unknown => {
    const binding = requireBinding(path);
    let params: unknown;
    try {
      params = binding.descriptor.input.parse(input);
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
    executePath: executeUnknownPath,
    executeUnknownPath,
  } as WalletOperationExecutor<TContext, TOperations, THandlers>;
};
