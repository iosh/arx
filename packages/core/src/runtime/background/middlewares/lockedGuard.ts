import { ArxReasons, arxError } from "@arx/errors";
import { createAsyncMiddleware } from "@metamask/json-rpc-engine";
import type { MethodDefinition } from "../../../rpc/handlers/types.js";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import type { AttentionService } from "../../../services/attention/types.js";
import type { ArxMiddlewareRequest } from "./requestTypes.js";

type LockedDefinition = Pick<MethodDefinition, "scope" | "locked"> | undefined;

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

    if (isInternalOrigin(origin) || isUnlocked()) {
      return next();
    }

    const invocation = reqWithArx.arxInvocation;
    const rpcContext = invocation?.rpcContext ?? reqWithArx.arx;
    const requestUnlockAttention = (method: string) => {
      try {
        attentionService.requestAttention({
          reason: "unlock_required",
          origin,
          method,
          chainRef: invocation?.chainRef ?? rpcContext?.chainRef ?? null,
          namespace: invocation?.namespace ?? rpcContext?.namespace ?? null,
        });
      } catch {}
    };
    const definition = findMethodDefinition(req.method, rpcContext);
    const passthrough = getPassthroughAllowance(req.method, rpcContext);

    if (!definition) {
      if (passthrough.isPassthrough) {
        if (passthrough.allowWhenLocked) {
          return next();
        }
        requestUnlockAttention(req.method);
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
      switch (locked.type) {
        case "response":
          res.result = locked.response;
          return;
        case "allow":
          return next();
        case "queue":
          requestUnlockAttention(req.method);
          return next();
        case "deny":
          requestUnlockAttention(req.method);
          throw arxError({
            reason: ArxReasons.SessionLocked,
            message: `Request ${req.method} requires an unlocked session`,
            data: { origin, method: req.method },
          });
      }
    }

    // No locked policy configured for this method: public methods without scope still run.
    if (!definition.scope) {
      return next();
    }

    requestUnlockAttention(req.method);
    throw arxError({
      reason: ArxReasons.SessionLocked,
      message: `Request ${req.method} requires an unlocked session`,
      data: { origin, method: req.method },
    });
  });
};
