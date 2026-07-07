import { RpcUnsupportedMethodError } from "../rpc/errors.js";

export type MethodHandler<TMethod> = TMethod extends (...args: infer TArgs) => infer TResult
  ? TArgs["length"] extends 0 | 1
    ? (...args: TArgs) => Awaited<TResult> | Promise<Awaited<TResult>>
    : never
  : never;

export type MethodHandlerTree<TApi extends object> = Readonly<{
  [K in keyof TApi]: TApi[K] extends (...args: infer _TArgs) => infer _TResult
    ? MethodHandler<TApi[K]>
    : TApi[K] extends object
      ? MethodHandlerTree<TApi[K]>
      : never;
}>;

type MethodBinding = {
  handler: (input?: unknown) => unknown | Promise<unknown>;
};

export type MethodExecutor = Readonly<{
  executePath(path: string, input: unknown): Promise<unknown>;
}>;

export type MethodCall = <TResult>(path: string, input?: unknown) => Promise<TResult>;

const bindMethodHandlers = <TApi extends object>(handlers: MethodHandlerTree<TApi>): Map<string, MethodBinding> => {
  const bindingsByPath = new Map<string, MethodBinding>();

  const bindNode = (node: Record<string, unknown>, segments: string[]): void => {
    for (const [key, childNode] of Object.entries(node)) {
      const pathSegments = [...segments, key];
      const path = pathSegments.join(".");

      if (typeof childNode === "function") {
        bindingsByPath.set(path, {
          handler: childNode as (input?: unknown) => unknown | Promise<unknown>,
        });
        continue;
      }

      bindNode(childNode as Record<string, unknown>, pathSegments);
    }
  };

  bindNode(handlers as Record<string, unknown>, []);

  return bindingsByPath;
};

const createMethodApiProxyNode = (call: MethodCall, segments: readonly string[]): unknown => {
  const path = segments.join(".");
  const target = () => undefined;

  return new Proxy(target, {
    apply: (_target, _thisArg, args) => call(path, args[0]),
    get: (_target, property) => {
      if (property === "then" || typeof property !== "string") {
        return undefined;
      }

      return createMethodApiProxyNode(call, [...segments, property]);
    },
  });
};

export const createMethodApiProxy = <TApi extends object>(call: MethodCall): TApi =>
  createMethodApiProxyNode(call, []) as TApi;

export const createMethodExecutor = <TApi extends object>(deps: {
  handlers: MethodHandlerTree<TApi>;
}): MethodExecutor => {
  const bindingsByPath = bindMethodHandlers<TApi>(deps.handlers);

  const requireBinding = (path: string): MethodBinding => {
    const binding = bindingsByPath.get(path);
    if (!binding) {
      throw new RpcUnsupportedMethodError({ message: `Unsupported method: ${path}` });
    }
    return binding;
  };

  return {
    executePath: async (path, input) => {
      const binding = requireBinding(path);
      return await binding.handler(input);
    },
  };
};
