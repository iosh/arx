import { RpcUnsupportedMethodError } from "../rpc/errors.js";

export type MethodHandler<TContext, TMethod> = TMethod extends (...args: infer TArgs) => infer TResult
  ? TArgs["length"] extends 0 | 1
    ? (context: TContext, ...args: TArgs) => Awaited<TResult> | Promise<Awaited<TResult>>
    : never
  : never;

export type MethodHandlerTree<TContext, TApi extends object> = Readonly<{
  [K in keyof TApi]: TApi[K] extends (...args: infer _TArgs) => infer _TResult
    ? MethodHandler<TContext, TApi[K]>
    : TApi[K] extends object
      ? MethodHandlerTree<TContext, TApi[K]>
      : never;
}>;

type MethodBinding<TContext> = {
  handler: (context: TContext, input?: unknown) => unknown | Promise<unknown>;
};

export type MethodExecutor = Readonly<{
  executePath(path: string, input: unknown): Promise<unknown>;
}>;

export type MethodCall = <TResult>(path: string, input?: unknown) => Promise<TResult>;

const bindMethodHandlers = <TContext, TApi extends object>(
  handlers: MethodHandlerTree<TContext, TApi>,
): Map<string, MethodBinding<TContext>> => {
  const bindingsByPath = new Map<string, MethodBinding<TContext>>();

  const bindNode = (node: Record<string, unknown>, segments: string[]): void => {
    for (const [key, childNode] of Object.entries(node)) {
      const pathSegments = [...segments, key];
      const path = pathSegments.join(".");

      if (typeof childNode === "function") {
        bindingsByPath.set(path, {
          handler: childNode as (context: TContext, input?: unknown) => unknown | Promise<unknown>,
        });
        continue;
      }

      bindNode(childNode as Record<string, unknown>, pathSegments);
    }
  };

  bindNode(handlers as Record<string, unknown>, []);

  return bindingsByPath;
};

const createMethodApiNode = (node: unknown, call: MethodCall, segments: string[]): unknown => {
  if (typeof node === "function") {
    const path = segments.join(".");
    return (...args: unknown[]) => call(path, args[0]);
  }

  const apiNode: Record<string, unknown> = {};
  for (const [key, childNode] of Object.entries(node as Record<string, unknown>)) {
    apiNode[key] = createMethodApiNode(childNode, call, [...segments, key]);
  }
  return apiNode;
};

export const createMethodApiFromHandlers = <TContext, TApi extends object>(
  handlers: MethodHandlerTree<TContext, TApi>,
  call: MethodCall,
): TApi => {
  return createMethodApiNode(handlers, call, []) as TApi;
};

export const createMethodExecutor = <TContext, TApi extends object>(deps: {
  context: TContext;
  handlers: MethodHandlerTree<TContext, TApi>;
}): MethodExecutor => {
  const bindingsByPath = bindMethodHandlers<TContext, TApi>(deps.handlers);

  const requireBinding = (path: string): MethodBinding<TContext> => {
    const binding = bindingsByPath.get(path);
    if (!binding) {
      throw new RpcUnsupportedMethodError({ message: `Unsupported method: ${path}` });
    }
    return binding;
  };

  return {
    executePath: async (path, input) => {
      const binding = requireBinding(path);
      return await binding.handler(deps.context, input);
    },
  };
};
