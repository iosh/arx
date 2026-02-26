import { createAsyncMiddleware, type JsonRpcEngine, type JsonRpcMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcError, JsonRpcParams } from "@metamask/utils";
import type { AttentionService, RequestAttentionParams } from "../../services/runtime/attention/index.js";
import type { createBackgroundRuntime } from "../createBackgroundRuntime.js";
import { UNKNOWN_ORIGIN } from "./constants.js";
import { createAccessPolicyGuardMiddleware } from "./middlewares/accessPolicyGuard.js";
import { createInvocationContextMiddleware } from "./middlewares/invocationContext.js";
import type { ArxMiddlewareRequest } from "./middlewares/requestTypes.js";
import { createRequireInitializedMiddleware } from "./middlewares/requireInitialized.js";

export type BackgroundRuntimeInstance = ReturnType<typeof createBackgroundRuntime>;

export type BackgroundRpcEnvHooks = {
  isInternalOrigin(origin: string): boolean;

  shouldRequestUnlockAttention?: (ctx: {
    origin: string;
    method: string;
    chainRef: string | null;
    namespace: string | null;
  }) => boolean;
};

const BACKGROUND_RPC_ENGINE_ASSEMBLED = Symbol.for("@arx/core/backgroundRpcEngineAssembled");

type Middleware = JsonRpcMiddleware<JsonRpcParams, Json>;

// Extended engine type with assembly flag for idempotent assembly
type EngineWithAssemblyFlag = JsonRpcEngine & {
  [BACKGROUND_RPC_ENGINE_ASSEMBLED]?: boolean;
};

const safeGetAttentionSnapshot = (service: AttentionService) => {
  try {
    return service.getSnapshot();
  } catch {
    return { queue: [], count: 0 };
  }
};

const safeRequestAttention = (service: AttentionService, params: RequestAttentionParams) => {
  try {
    return service.requestAttention(params);
  } catch {
    return { enqueued: false, request: null, state: safeGetAttentionSnapshot(service) };
  }
};

export const createBackgroundRpcMiddlewares = (runtime: BackgroundRuntimeInstance, envHooks: BackgroundRpcEnvHooks) => {
  const controllers = runtime.controllers;
  const rpcRegistry = runtime.rpc.registry;

  const executeMethod = rpcRegistry.createMethodExecutor(controllers, { rpcClientRegistry: runtime.rpc.clients });

  const invocationContext: Middleware = createInvocationContextMiddleware({
    resolve: (method, ctx) => rpcRegistry.resolveInvocationDetails(controllers, method, ctx),
  }) as unknown as Middleware;

  const errorBoundary: Middleware = createAsyncMiddleware(async (req, res, next) => {
    const reqWithArx = req as typeof req & ArxMiddlewareRequest;
    const encode = (error: unknown) => {
      const invocation = reqWithArx.arxInvocation;
      const rpcContext = invocation?.rpcContext ?? reqWithArx.arx ?? undefined;
      const origin = invocation?.origin ?? reqWithArx.origin ?? UNKNOWN_ORIGIN;
      const chainRef =
        invocation?.chainRef ?? rpcContext?.chainRef ?? controllers.network.getActiveChain().chainRef ?? null;
      const namespace =
        invocation?.namespace ??
        rpcContext?.namespace?.split(":")[0] ??
        (typeof chainRef === "string" ? chainRef.split(":")[0] : null) ??
        "eip155";

      return rpcRegistry.encodeErrorWithAdapters(error, {
        surface: "dapp",
        namespace,
        chainRef,
        origin,
        method: req.method,
      }) as JsonRpcError;
    };

    try {
      await next();
    } catch (error) {
      res.error = encode(error);
      return;
    }

    if (res.error) {
      res.error = encode(res.error);
    }
  });

  const requireInitialized: Middleware = createRequireInitializedMiddleware({
    getIsInitialized: runtime.lifecycle.getIsInitialized,
  }) as unknown as Middleware;

  const accessPolicyGuardDeps: Parameters<typeof createAccessPolicyGuardMiddleware>[0] = {
    isUnlocked: () => runtime.services.session.unlock.isUnlocked(),
    isInternalOrigin: envHooks.isInternalOrigin,
    requestAttention: (args) => {
      safeRequestAttention(runtime.services.attention as AttentionService, {
        reason: "unlock_required",
        origin: args.origin,
        method: args.method,
        chainRef: args.chainRef,
        namespace: args.namespace,
      });
    },
    assertPermission: (origin, method, context) => controllers.permissions.assertPermission(origin, method, context),
    isConnected: (origin, options) => controllers.permissions.isConnected(origin, options),
    ...(envHooks.shouldRequestUnlockAttention
      ? { shouldRequestUnlockAttention: envHooks.shouldRequestUnlockAttention }
      : {}),
  };

  const accessPolicyGuard: Middleware = createAccessPolicyGuardMiddleware(
    accessPolicyGuardDeps,
  ) as unknown as Middleware;

  const executor: Middleware = createAsyncMiddleware(async (req, res) => {
    const reqWithArx = req as typeof req & ArxMiddlewareRequest;
    const arxInvocation = reqWithArx.arxInvocation;
    const origin = arxInvocation?.origin ?? reqWithArx.origin ?? UNKNOWN_ORIGIN;
    const rpcContext = arxInvocation?.rpcContext ?? reqWithArx.arx;

    const rpcInvocation = {
      origin,
      request: {
        method: req.method,
        ...(req.params !== undefined ? { params: req.params } : {}),
      },
      ...(rpcContext ? { context: rpcContext } : {}),
    };

    const result = await executeMethod(rpcInvocation);
    res.result = result as Json;
  });

  // Put errorBoundary first so any downstream middleware errors are encoded consistently.
  return [errorBoundary, requireInitialized, invocationContext, accessPolicyGuard, executor];
};

export const createRpcEngineForBackground = (runtime: BackgroundRuntimeInstance, envHooks: BackgroundRpcEnvHooks) => {
  const engine = runtime.rpc.engine as EngineWithAssemblyFlag;

  if (engine[BACKGROUND_RPC_ENGINE_ASSEMBLED]) {
    return runtime.rpc.engine;
  }

  // Symbol flag prevents silent middleware duplication across multiple initializations.
  engine[BACKGROUND_RPC_ENGINE_ASSEMBLED] = true;

  try {
    for (const middleware of createBackgroundRpcMiddlewares(runtime, envHooks)) {
      runtime.rpc.engine.push(middleware);
    }
    return runtime.rpc.engine;
  } catch (error) {
    delete engine[BACKGROUND_RPC_ENGINE_ASSEMBLED];
    throw error;
  }
};
