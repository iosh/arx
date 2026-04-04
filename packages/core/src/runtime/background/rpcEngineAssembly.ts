import { createAsyncMiddleware, type JsonRpcEngine, type JsonRpcMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcError, JsonRpcParams } from "@metamask/utils";
import type { AttentionService, RequestAttentionParams } from "../../services/runtime/attention/index.js";
import type { BackgroundRuntime } from "../createBackgroundRuntime.js";
import { UNKNOWN_ORIGIN } from "./constants.js";
import { createAccessPolicyGuardMiddleware } from "./middlewares/accessPolicyGuard.js";
import { createInvocationContextMiddleware } from "./middlewares/invocationContext.js";
import type { ArxMiddlewareRequest } from "./middlewares/requestTypes.js";
import { createRequireInitializedMiddleware } from "./middlewares/requireInitialized.js";

export type BackgroundRpcRuntime = Pick<BackgroundRuntime, "controllers" | "surfaceErrors" | "lifecycle"> & {
  services: Pick<BackgroundRuntime["services"], "attention" | "permissionViews" | "sessionStatus">;
  rpc: Pick<
    BackgroundRuntime["rpc"],
    "engine" | "resolveMethodNamespace" | "resolveInvocationDetails" | "executeRequest"
  >;
};

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

export const createBackgroundRpcMiddlewares = (runtime: BackgroundRpcRuntime, envHooks: BackgroundRpcEnvHooks) => {
  const controllers = runtime.controllers;
  const resolveMethodNamespace = runtime.rpc.resolveMethodNamespace;
  const executeRequest = runtime.rpc.executeRequest;

  const invocationContext: Middleware = createInvocationContextMiddleware({
    resolve: (method, ctx) => runtime.rpc.resolveInvocationDetails(method, ctx),
  }) as unknown as Middleware;

  const errorBoundary: Middleware = createAsyncMiddleware(async (req, res, next) => {
    const reqWithArx = req as typeof req & ArxMiddlewareRequest;
    const encode = (error: unknown) => {
      const invocation = reqWithArx.arxInvocation;
      const rpcContext = invocation?.rpcContext ?? reqWithArx.arx ?? undefined;
      const origin = invocation?.origin ?? reqWithArx.origin ?? UNKNOWN_ORIGIN;
      const namespace = invocation?.namespace ?? resolveMethodNamespace(req.method, rpcContext) ?? null;
      const chainRef =
        invocation?.chainRef ??
        rpcContext?.chainRef ??
        (namespace ? controllers.networkPreferences.getActiveChainRef(namespace) : null) ??
        null;

      return runtime.surfaceErrors.encodeDapp(error, {
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
    isUnlocked: () => runtime.services.sessionStatus.isUnlocked(),
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
    isConnected: (origin, options) => {
      const { chainRef } = options;
      return runtime.services.permissionViews.getConnectionSnapshot(origin, { chainRef }).isConnected;
    },
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

    const result = await executeRequest(rpcInvocation);
    res.result = result as Json;
  });

  // Put errorBoundary first so any downstream middleware errors are encoded consistently.
  return [errorBoundary, requireInitialized, invocationContext, accessPolicyGuard, executor];
};

export const createRpcEngineForBackground = (runtime: BackgroundRpcRuntime, envHooks: BackgroundRpcEnvHooks) => {
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
