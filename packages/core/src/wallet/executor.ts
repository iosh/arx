import { RpcUnsupportedMethodError } from "../rpc/errors.js";
import { WalletMethodBindingInvariantError } from "./errors.js";

export type WalletMethodHandler<TContext, TMethod> = TMethod extends (...args: infer TArgs) => infer TResult
  ? TArgs["length"] extends 0 | 1
    ? (context: TContext, ...args: TArgs) => Awaited<TResult> | Promise<Awaited<TResult>>
    : never
  : never;

export type WalletMethodHandlerTree<TContext, TApi extends object> = Readonly<{
  [K in keyof TApi]: TApi[K] extends (...args: infer _TArgs) => infer _TResult
    ? WalletMethodHandler<TContext, TApi[K]>
    : TApi[K] extends object
      ? WalletMethodHandlerTree<TContext, TApi[K]>
      : never;
}>;

type WalletMethodBinding<TContext> = {
  handler: (context: TContext, input?: unknown) => unknown | Promise<unknown>;
};

export type WalletMethodExecutor = Readonly<{
  executeUnknownPath(path: string, input: unknown): Promise<unknown>;
}>;

const bindWalletMethodHandlers = <TContext, TApi extends object>(
  handlers: WalletMethodHandlerTree<TContext, TApi>,
): Map<string, WalletMethodBinding<TContext>> => {
  const bindingsByPath = new Map<string, WalletMethodBinding<TContext>>();

  const bindNode = (node: unknown, segments: string[]): void => {
    if (typeof node !== "object" || node === null) {
      throw new WalletMethodBindingInvariantError({
        path: segments.join("."),
        message: `Wallet method handler branch "${segments.join(".")}" is not an object.`,
      });
    }

    for (const [key, childNode] of Object.entries(node)) {
      const pathSegments = [...segments, key];
      const path = pathSegments.join(".");

      if (typeof childNode === "function") {
        bindingsByPath.set(path, {
          handler: childNode as (context: TContext, input?: unknown) => unknown | Promise<unknown>,
        });
        continue;
      }

      bindNode(childNode, pathSegments);
    }
  };

  bindNode(handlers, []);

  return bindingsByPath;
};

export const createWalletMethodExecutor = <TContext, TApi extends object>(deps: {
  context: TContext;
  handlers: WalletMethodHandlerTree<TContext, TApi>;
}): WalletMethodExecutor => {
  const bindingsByPath = bindWalletMethodHandlers<TContext, TApi>(deps.handlers);

  const requireBinding = (path: string): WalletMethodBinding<TContext> => {
    const binding = bindingsByPath.get(path);
    if (!binding) {
      throw new RpcUnsupportedMethodError({ message: `Unsupported wallet method: ${path}` });
    }
    return binding;
  };

  return {
    executeUnknownPath: async (path, input) => {
      const binding = requireBinding(path);
      return await binding.handler(deps.context, input);
    },
  };
};
