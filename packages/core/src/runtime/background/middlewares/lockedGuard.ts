import { ArxReasons, arxError } from "@arx/errors";
import { createAsyncMiddleware } from "@metamask/json-rpc-engine";
import type { MethodDefinition } from "../../../rpc/handlers/types.js";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import type { AttentionService } from "../../../services/attention/types.js";
import type { ArxMiddlewareRequest } from "./requestTypes.js";

/**
 * Lock policy priority (highest to lowest):
 * 1. Method definition's own `locked` configuration
 * 2. Default: reject while the session stays locked
 *
 * Note: Chain-level locked policies have been removed; all locked behavior is method-level.
 */

type LockedDefinition = Pick<MethodDefinition, "scope" | "approvalRequired" | "locked"> | undefined;

type PassthroughAllowance = {
  isPassthrough: boolean;
  allowWhenLocked: boolean;
};
type LockedGuardDeps = {
  isUnlocked(): boolean;
  isInternalOrigin(origin: string): boolean;
  findMethodDefinition(method: string, context?: RpcInvocationContext): LockedDefinition;
  getPassthroughAllowance(method: string, context?: RpcInvocationContext): PassthroughAllowance;
  attentionService: Pick<AttentionService, "requestAttention">;
};
/**
 * Guard RPC calls while the session is locked.
 * Internal origins or unlocked sessions pass through.
 * If a method is not registered, throw unsupportedMethod.
 * Public methods without scope still run (unless an explicit locked policy is configured).
 * locked.allow lets a method run; locked.response sends a fixed result.
 * Everything else throws unauthorized until the user unlocks.
 */
export const createLockedGuardMiddleware = ({
  isUnlocked,
  isInternalOrigin,
  findMethodDefinition,
  getPassthroughAllowance,
  attentionService,
}: LockedGuardDeps) => {
  return createAsyncMiddleware(async (req, res, next) => {
    const reqWithArx = req as typeof req & ArxMiddlewareRequest;
    const origin = reqWithArx.origin ?? "unknown://";

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

    const rpcContext = reqWithArx.arx;
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

    const locked = definition.locked;
    if (locked) {
      if ("response" in locked) {
        res.result = locked.response;
        return;
      }
      if (locked.allow === true) {
        return next();
      }
      // allow:false
      requestUnlockAttention(req.method, rpcContext);
      throw arxError({
        reason: ArxReasons.SessionLocked,
        message: `Request ${req.method} requires an unlocked session`,
        data: { origin, method: req.method },
      });
    }

    // No locked policy configured for this method: public methods without scope still run.
    if (!definition.scope) {
      return next();
    }

    // For approval-based methods, do not hard-reject while locked.
    // Let the request reach the handler so it can enqueue an approval and keep the dApp RPC pending.
    // The UI will prompt for unlock before the user can approve.
    if (definition.approvalRequired) {
      return next();
    }

    requestUnlockAttention(req.method, rpcContext);
    throw arxError({
      reason: ArxReasons.SessionLocked,
      message: `Request ${req.method} requires an unlocked session`,
      data: { origin, method: req.method },
    });
  });
};
