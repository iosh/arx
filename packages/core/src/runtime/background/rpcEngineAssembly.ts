import { createAsyncMiddleware, type JsonRpcEngine, type JsonRpcMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcError, JsonRpcParams } from "@metamask/utils";
import {
  createMethodDefinitionResolver,
  createMethodExecutor,
  createMethodNamespaceResolver,
  encodeErrorWithAdapters,
  getRegisteredNamespaceAdapters,
  type RpcInvocationContext,
} from "../../rpc/index.js";
import type { AttentionService, RequestAttentionParams } from "../../services/attention/index.js";
import type { createBackgroundServices } from "../createBackgroundServices.js";
import { UNKNOWN_ORIGIN } from "./constants.js";
import { createLockedGuardMiddleware } from "./middlewares/lockedGuard.js";
import { createPermissionGuardMiddleware } from "./middlewares/permissionGuard.js";
import { type ArxInvocation, createResolveInvocationMiddleware } from "./middlewares/resolveInvocation.js";
import { createValidateParamsMiddleware } from "./middlewares/validateParams.js";

export type BackgroundServices = ReturnType<typeof createBackgroundServices>;

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

const wrapAttentionService = (service: AttentionService, envHooks: BackgroundRpcEnvHooks) => {
  const shouldRequestUnlock = envHooks.shouldRequestUnlockAttention ?? (() => true);

  const wrapped: Pick<AttentionService, "requestAttention"> = {
    requestAttention: (params) => {
      // Check unlock attention hook
      if (params.reason === "unlock_required") {
        const ok = shouldRequestUnlock({
          origin: params.origin,
          method: params.method,
          chainRef: params.chainRef ?? null,
          namespace: params.namespace ?? null,
        });
        if (!ok) {
          return { enqueued: false, request: null, state: safeGetAttentionSnapshot(service) };
        }
      }

      return safeRequestAttention(service, params);
    },
  };

  return wrapped;
};

export const createBackgroundRpcMiddlewares = (services: BackgroundServices, envHooks: BackgroundRpcEnvHooks) => {
  const controllers = services.controllers;

  const findMethodDefinition = createMethodDefinitionResolver(controllers);
  const deriveMethodNamespace = createMethodNamespaceResolver(controllers);

  const executeMethod = createMethodExecutor(controllers, { rpcClientRegistry: services.rpcClients });

  // Wrap attention service with hook-aware behavior (unified handling for all attention types)
  const wrappedAttentionService = wrapAttentionService(services.attention, envHooks);

  const readLockedPoliciesForChain = (chainRef: string | null | undefined) => {
    if (!chainRef) return null;

    const networkChain = controllers.network.getChain(chainRef);

    if (networkChain?.providerPolicies?.locked) {
      return networkChain.providerPolicies.locked;
    }

    const registryEntity = controllers.chainRegistry.getChain(chainRef);
    return registryEntity?.metadata.providerPolicies?.locked ?? null;
  };

  const deriveLockedPolicy = (method: string, rpcContext?: RpcInvocationContext) => {
    const chainRef = rpcContext?.chainRef ?? controllers.network.getActiveChain().chainRef;
    const policies = readLockedPoliciesForChain(chainRef);
    if (!policies) return undefined;

    const pick = (key: string) => (Object.hasOwn(policies, key) ? policies[key] : undefined);
    const selected = pick(method);
    const fallback = selected === undefined ? pick("*") : undefined;
    const value = selected ?? fallback;

    if (value === undefined || value === null) return undefined;

    const result: { allow?: boolean; response?: unknown; hasResponse?: boolean } = {
      hasResponse: Object.hasOwn(value, "response"),
    };
    if (value.allow !== undefined) {
      result.allow = value.allow;
    }
    if (result.hasResponse) {
      result.response = value.response;
    }
    return result;
  };
  const getPassthroughAllowance = (method: string, rpcContext?: RpcInvocationContext) => {
    const namespace = deriveMethodNamespace(method, rpcContext);
    const adapter = getRegisteredNamespaceAdapters().find((entry) => entry.namespace === namespace);
    if (!adapter?.passthrough) {
      return { isPassthrough: false, allowWhenLocked: false };
    }
    const isPassthrough = adapter.passthrough.allowedMethods.includes(method);
    return {
      isPassthrough,
      allowWhenLocked: isPassthrough && (adapter.passthrough.allowWhenLocked?.includes(method) ?? false),
    };
  };

  const resolveInvocation: Middleware = createResolveInvocationMiddleware({
    deriveNamespace: (method, ctx) => deriveMethodNamespace(method, ctx),
    getActiveChainRef: () => controllers.network.getActiveChain().chainRef,
  }) as unknown as Middleware;

  const errorBoundary: Middleware = createAsyncMiddleware(async (req, res, next) => {
    const invocation = (req as { arxInvocation?: ArxInvocation }).arxInvocation;
    const rpcContext = invocation?.rpcContext ?? (req as { arx?: RpcInvocationContext }).arx;
    const origin = invocation?.origin ?? (req as { origin?: string }).origin ?? UNKNOWN_ORIGIN;
    const namespace = invocation?.namespace ?? deriveMethodNamespace(req.method, rpcContext ?? undefined);
    const chainRef = invocation?.chainRef ?? rpcContext?.chainRef ?? controllers.network.getActiveChain().chainRef;

    try {
      await next();
    } catch (error) {
      res.error = encodeErrorWithAdapters(error, {
        surface: "dapp",
        namespace,
        chainRef,
        origin,
        method: req.method,
      }) as JsonRpcError;
      return;
    }

    if (res.error) {
      res.error = encodeErrorWithAdapters(res.error, {
        surface: "dapp",
        namespace,
        chainRef,
        origin,
        method: req.method,
      }) as JsonRpcError;
    }
  });

  const lockedGuard: Middleware = createLockedGuardMiddleware({
    isUnlocked: () => services.session.unlock.isUnlocked(),
    isInternalOrigin: envHooks.isInternalOrigin,
    findMethodDefinition,
    deriveLockedPolicy,
    getPassthroughAllowance,
    attentionService: wrappedAttentionService,
  }) as unknown as Middleware;

  const permissionGuard: Middleware = createPermissionGuardMiddleware({
    assertPermission: (origin, method, context) => controllers.permissions.assertPermission(origin, method, context),
    isInternalOrigin: envHooks.isInternalOrigin,
    isConnected: (origin, options) => controllers.permissions.isConnected(origin, options),
    findMethodDefinition,
  });

  const validateParams: Middleware = createValidateParamsMiddleware({ findMethodDefinition }) as unknown as Middleware;

  const executor: Middleware = createAsyncMiddleware(async (req, res) => {
    const arxInvocation = (req as { arxInvocation?: ArxInvocation }).arxInvocation;
    const origin = arxInvocation?.origin ?? (req as { origin?: string }).origin ?? UNKNOWN_ORIGIN;
    const rpcContext = arxInvocation?.rpcContext ?? (req as { arx?: RpcInvocationContext }).arx;

    const rpcInvocation = {
      origin,
      request: { method: req.method, params: req.params as JsonRpcParams },
      ...(rpcContext ? { context: rpcContext } : {}),
    };

    const result = await executeMethod(rpcInvocation);
    res.result = result as Json;
  });

  return [resolveInvocation, errorBoundary, lockedGuard, permissionGuard, validateParams, executor];
};

export const createRpcEngineForBackground = (services: BackgroundServices, envHooks: BackgroundRpcEnvHooks) => {
  const engine = services.engine as EngineWithAssemblyFlag;

  if (engine[BACKGROUND_RPC_ENGINE_ASSEMBLED]) {
    return services.engine;
  }

  // Symbol flag prevents silent middleware duplication across multiple initializations.
  engine[BACKGROUND_RPC_ENGINE_ASSEMBLED] = true;

  try {
    for (const middleware of createBackgroundRpcMiddlewares(services, envHooks)) {
      services.engine.push(middleware);
    }
    return services.engine;
  } catch (error) {
    delete engine[BACKGROUND_RPC_ENGINE_ASSEMBLED];
    throw error;
  }
};
