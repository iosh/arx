import { createAsyncMiddleware, type Json, type RpcInvocationContext } from "@arx/core";

/**
 * Lock policy priority (highest to lowest):
 * 1. Chain providerPolicies.locked entry for the exact method
 * 2. Chain providerPolicies.locked wildcard "*" entry
 * 3. Method definition's own `locked` configuration
 * 4. Default: reject while the session stays locked
 */

type LockedDefinition =
  | {
      scope?: unknown;
      locked?: {
        allow?: boolean;
        response?: unknown;
      };
    }
  | undefined;

type LockedGuardDeps = {
  isUnlocked(): boolean;
  isInternalOrigin(origin: string): boolean;
  resolveMethodDefinition(method: string, context?: RpcInvocationContext): LockedDefinition;
  resolveLockedPolicy(
    method: string,
    context?: RpcInvocationContext,
  ): { allow?: boolean; response?: unknown; hasResponse?: boolean } | undefined;
  resolveProviderErrors(context?: RpcInvocationContext): {
    unauthorized(args: { message: string; data: { origin: string; method: string } }): unknown;
  };
};

/**
 * guard RPC calls whil the session is locked
 * internal origins or unlocked sessions pass through
 * if a method is not registered throw unsupportedMethod.
 * public methods without scope still run
 * locked.allow lets a method run. locked.response sends a fixed result.
 * everthing else throws unauthorized until the user unlocks.
 */
export const createLockedGuardMiddleware = ({
  isUnlocked,
  isInternalOrigin,
  resolveMethodDefinition,
  resolveLockedPolicy,
  resolveProviderErrors,
}: LockedGuardDeps) => {
  return createAsyncMiddleware(async (req, res, next) => {
    const origin = (req as { origin?: string }).origin ?? "unknown://";

    if (isInternalOrigin(origin) || isUnlocked()) {
      return next();
    }

    const rpcContext = (req as { arx?: RpcInvocationContext }).arx;
    const definition = resolveMethodDefinition(req.method, rpcContext);

    if (!definition) {
      throw resolveProviderErrors(rpcContext).unauthorized({
        message: `Request ${req.method} is blocked until the active namespace declares it`,
        data: { origin, method: req.method },
      });
    }

    if (!definition.scope) {
      return next();
    }

    const resolvedPolicy = resolveLockedPolicy(req.method, rpcContext);
    const locked = resolvedPolicy ?? definition.locked ?? {};

    if (resolvedPolicy?.allow ?? locked.allow) {
      return next();
    }

    if (resolvedPolicy?.hasResponse || Object.hasOwn(locked, "response")) {
      res.result = (resolvedPolicy?.response ?? locked.response) as Json;
      return;
    }

    throw resolveProviderErrors(rpcContext).unauthorized({
      message: `Request ${req.method} requires an unlocked session`,
      data: { origin, method: req.method },
    });
  });
};
