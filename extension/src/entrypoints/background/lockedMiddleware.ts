import { createAsyncMiddleware, type Json } from "@arx/core";

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
  resolveMethodDefinition(method: string): LockedDefinition;
  resolveProviderErrors(): {
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
  resolveProviderErrors,
}: LockedGuardDeps) => {
  return createAsyncMiddleware(async (req, res, next) => {
    const origin = (req as { origin?: string }).origin ?? "unknown://";

    if (isInternalOrigin(origin) || isUnlocked()) {
      return next();
    }

    const definition = resolveMethodDefinition(req.method);

    if (!definition) {
      throw resolveProviderErrors().unauthorized({
        message: `Request ${req.method} is blocked until the active namespace declares it`,
        data: { origin, method: req.method },
      });
    }

    if (!definition.scope) {
      return next();
    }

    const locked = definition.locked ?? {};
    if (locked.allow) {
      return next();
    }

    if (Object.hasOwn(locked, "response")) {
      res.result = locked.response as Json;
      return;
    }

    throw resolveProviderErrors().unauthorized({
      message: `Request ${req.method} requires an unlocked session`,
      data: { origin, method: req.method },
    });
  });
};
