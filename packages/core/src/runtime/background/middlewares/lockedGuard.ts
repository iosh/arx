import { ArxReasons, arxError } from "@arx/errors";
import { createAsyncMiddleware } from "@metamask/json-rpc-engine";
import type { Json } from "@metamask/utils";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import type { AttentionService } from "../../../services/attention/types.js";

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

type PassthroughAllowance = {
  isPassthrough: boolean;
  allowWhenLocked: boolean;
};
type LockedGuardDeps = {
  isUnlocked(): boolean;
  isInternalOrigin(origin: string): boolean;
  findMethodDefinition(method: string, context?: RpcInvocationContext): LockedDefinition;
  deriveLockedPolicy(
    method: string,
    context?: RpcInvocationContext,
  ): { allow?: boolean; response?: unknown; hasResponse?: boolean } | undefined;
  getPassthroughAllowance(method: string, context?: RpcInvocationContext): PassthroughAllowance;
  attentionService: Pick<AttentionService, "requestAttention">;
};
/**
 * Guard RPC calls while the session is locked.
 * Internal origins or unlocked sessions pass through.
 * If a method is not registered, throw unsupportedMethod.
 * Public methods without scope still run.
 * locked.allow lets a method run; locked.response sends a fixed result.
 * Everything else throws unauthorized until the user unlocks.
 */
export const createLockedGuardMiddleware = ({
  isUnlocked,
  isInternalOrigin,
  findMethodDefinition,
  deriveLockedPolicy,
  getPassthroughAllowance,
  attentionService,
}: LockedGuardDeps) => {
  return createAsyncMiddleware(async (req, res, next) => {
    const origin = (req as { origin?: string }).origin ?? "unknown://";

    const requestUnlockAttention = (method: string, rpcContext?: RpcInvocationContext) => {
      try {
        attentionService.requestAttention({
          reason: "unlock_required",
          origin,
          method,
          chainRef: rpcContext?.chainRef ?? null,
          namespace: rpcContext?.namespace ?? null,
        });
      } catch {
        // Best-effort: never change RPC error behavior if attention fails.
      }
    };

    if (isInternalOrigin(origin) || isUnlocked()) {
      return next();
    }

    const rpcContext = (req as { arx?: RpcInvocationContext }).arx;
    const definition = findMethodDefinition(req.method, rpcContext);
    const passthrough = getPassthroughAllowance(req.method, rpcContext);

    if (!definition) {
      if (passthrough.isPassthrough) {
        if (passthrough.allowWhenLocked) {
          return next();
        }
        requestUnlockAttention(req.method, rpcContext);
        throw arxError({
          reason: ArxReasons.SessionLocked,
          message: `Request ${req.method} requires an unlocked session`,
          data: { origin, method: req.method },
        });
      }

      throw arxError({
        reason: ArxReasons.RpcMethodNotFound,
        message: `Method "${req.method}" is not implemented`,
        data: { origin, method: req.method, namespace: rpcContext?.namespace ?? null },
      });
    }

    if (!definition.scope) {
      return next();
    }

    const resolvedPolicy = deriveLockedPolicy(req.method, rpcContext);
    const locked = resolvedPolicy ?? definition.locked ?? {};

    if (resolvedPolicy?.allow ?? locked.allow) {
      return next();
    }

    if (resolvedPolicy?.hasResponse || Object.hasOwn(locked, "response")) {
      res.result = (resolvedPolicy?.response ?? locked.response) as Json;
      return;
    }

    requestUnlockAttention(req.method, rpcContext);
    throw arxError({
      reason: ArxReasons.SessionLocked,
      message: `Request ${req.method} requires an unlocked session`,
      data: { origin, method: req.method },
    });
  });
};
