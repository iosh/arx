import { ArxReasons, arxError } from "@arx/errors";
import { createAsyncMiddleware, type JsonRpcMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";
import type { ChainRef } from "../../../chains/ids.js";
import type { ChainNamespace } from "../../../controllers/index.js";
import { type AuthorizationRequirement, AuthorizationRequirements } from "../../../rpc/handlers/types.js";
import { UNKNOWN_ORIGIN } from "../constants.js";
import type { ArxMiddlewareRequest } from "./requestTypes.js";

type AccessPolicyGuardDeps = {
  isUnlocked(): boolean;
  isInternalOrigin(origin: string): boolean;

  shouldRequestUnlockAttention?: (ctx: {
    origin: string;
    method: string;
    chainRef: string | null;
    namespace: string | null;
  }) => boolean;
  requestAttention(args: {
    reason: "unlock_required";
    origin: string;
    method: string;
    chainRef: string | null;
    namespace: string | null;
  }): void;
  isAuthorized(origin: string, options: { namespace: ChainNamespace; chainRef: ChainRef }): boolean;
};

const assertNever = (value: never): never => {
  throw new Error(`Unexpected authorizationRequirement: ${String(value)}`);
};

export const createAccessPolicyGuardMiddleware = ({
  isUnlocked,
  isInternalOrigin,
  requestAttention,
  shouldRequestUnlockAttention,
  isAuthorized,
}: AccessPolicyGuardDeps): JsonRpcMiddleware<JsonRpcParams, Json> => {
  const shouldRequestUnlock = shouldRequestUnlockAttention ?? (() => true);

  return createAsyncMiddleware(async (req, res, next) => {
    const reqWithArx = req as typeof req & ArxMiddlewareRequest;

    const invocation = reqWithArx.arxInvocation;
    const rpcContext = invocation?.rpcContext ?? reqWithArx.arx;
    const origin = invocation?.origin ?? reqWithArx.origin ?? UNKNOWN_ORIGIN;

    if (isInternalOrigin(origin)) {
      await next();
      return;
    }

    const requestUnlockAttention = () => {
      if (
        !shouldRequestUnlock({
          origin,
          method: req.method,
          chainRef: invocation?.chainRef ?? rpcContext?.chainRef ?? null,
          namespace: invocation?.namespace ?? rpcContext?.namespace ?? null,
        })
      ) {
        return;
      }

      try {
        requestAttention({
          reason: "unlock_required",
          origin,
          method: req.method,
          chainRef: invocation?.chainRef ?? rpcContext?.chainRef ?? null,
          namespace: invocation?.namespace ?? rpcContext?.namespace ?? null,
        });
      } catch {
        // best-effort
      }
    };

    const unlocked = isUnlocked();
    const definition = invocation?.definition;
    const passthrough = invocation?.passthrough ?? { isPassthrough: false, allowWhenLocked: false };

    // No definition => either passthrough or method-not-found.
    if (!definition) {
      if (passthrough.isPassthrough) {
        if (unlocked || passthrough.allowWhenLocked) {
          await next();
          return;
        }
        requestUnlockAttention();
        throw arxError({
          reason: ArxReasons.SessionLocked,
          message: `Request ${req.method} requires an unlocked session`,
          data: { origin, method: req.method },
        });
      }

      throw arxError({
        reason: ArxReasons.RpcUnsupportedMethod,
        message: `Method "${req.method}" is not supported`,
        data: { origin, method: req.method, namespace: rpcContext?.namespace ?? null },
      });
    }

    // Locked policy.
    if (!unlocked) {
      const locked = definition.locked;
      if (locked) {
        switch (locked.type) {
          case "response":
            res.result = locked.response;
            return;
          case "allow":
            break; // continue to connection/execution
          case "queue":
            requestUnlockAttention();
            break; // continue to connection/execution after unlock attention
          case "deny":
            requestUnlockAttention();
            throw arxError({
              reason: ArxReasons.SessionLocked,
              message: `Request ${req.method} requires an unlocked session`,
              data: { origin, method: req.method },
            });
        }
      }
    }

    const authorizationRequirement: AuthorizationRequirement = definition.authorizationRequirement;

    switch (authorizationRequirement) {
      case AuthorizationRequirements.None: {
        await next();
        return;
      }
      case AuthorizationRequirements.Required: {
        const chainRef = invocation?.chainRef ?? rpcContext?.chainRef ?? null;
        const namespace = invocation?.namespace ?? rpcContext?.namespace ?? null;

        const authorized =
          origin !== UNKNOWN_ORIGIN &&
          namespace !== null &&
          chainRef !== null &&
          chainRef.length > 0 &&
          isAuthorized(origin, {
            namespace,
            chainRef: chainRef as ChainRef,
          });

        if (!authorized) {
          throw arxError({
            reason: ArxReasons.PermissionNotConnected,
            message: `Origin "${origin}" is not connected`,
            data: {
              origin,
              method: req.method,
              chainRef,
              namespace,
            },
          });
        }

        await next();
        return;
      }
    }

    return assertNever(authorizationRequirement);
  });
};
