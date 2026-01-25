import { ArxReasons, arxError } from "@arx/errors";
import { createAsyncMiddleware } from "@metamask/json-rpc-engine";
import type { Json } from "@metamask/utils";
import type { MethodDefinition } from "../../../rpc/handlers/types.js";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import type { AttentionService } from "../../../services/attention/types.js";

/**
 * Lock policy priority (highest to lowest):
 * 1. Chain providerPolicies.locked entry for the exact method
 * 2. Chain providerPolicies.locked wildcard "*" entry
 * 3. Method definition's own `locked` configuration
 * 4. Default: reject while the session stays locked
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
    const policyActive =
      resolvedPolicy !== undefined && (resolvedPolicy.allow !== undefined || resolvedPolicy.hasResponse === true);

    // Chain-level locked policy is the highest priority and cannot be bypassed by approvalRequired.
    if (policyActive) {
      if (resolvedPolicy.allow === true) {
        return next();
      }
      if (resolvedPolicy.hasResponse) {
        res.result = resolvedPolicy.response as Json;
        return;
      }

      // Explicit deny (allow:false with no response)
      requestUnlockAttention(req.method, rpcContext);
      throw arxError({
        reason: ArxReasons.SessionLocked,
        message: `Request ${req.method} requires an unlocked session`,
        data: { origin, method: req.method },
      });
    }

    const locked = definition.locked ?? {};

    if (locked.allow === true) {
      return next();
    }

    if (Object.hasOwn(locked, "response")) {
      res.result = locked.response as Json;
      return;
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
