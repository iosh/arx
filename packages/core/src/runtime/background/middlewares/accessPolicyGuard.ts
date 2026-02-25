import { ArxReasons, arxError, isArxError } from "@arx/errors";
import { createAsyncMiddleware, type JsonRpcMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";
import type { ChainRef } from "../../../chains/ids.js";
import type { ChainNamespace } from "../../../controllers/index.js";
import { type PermissionCheck, PermissionChecks } from "../../../rpc/handlers/types.js";
import type { RpcInvocationContext } from "../../../rpc/index.js";
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

  assertPermission(origin: string, method: string, context?: RpcInvocationContext): Promise<void>;
  isConnected(origin: string, options: { namespace?: ChainNamespace | null; chainRef: ChainRef }): boolean;
};

const assertNever = (value: never): never => {
  throw new Error(`Unexpected permissionCheck: ${String(value)}`);
};

export const createAccessPolicyGuardMiddleware = ({
  isUnlocked,
  isInternalOrigin,
  requestAttention,
  shouldRequestUnlockAttention,
  assertPermission,
  isConnected,
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
        reason: ArxReasons.RpcMethodNotFound,
        message: `Method "${req.method}" is not implemented`,
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
            break; // continue to permissions
          case "queue":
            requestUnlockAttention();
            break; // continue to permissions/execution (queues approval flow)
          case "deny":
            requestUnlockAttention();
            throw arxError({
              reason: ArxReasons.SessionLocked,
              message: `Request ${req.method} requires an unlocked session`,
              data: { origin, method: req.method },
            });
        }
      }

      // Default: methods with scope require unlock unless explicitly allowed above.
      if (definition.scope && locked?.type !== "allow" && locked?.type !== "queue") {
        requestUnlockAttention();
        throw arxError({
          reason: ArxReasons.SessionLocked,
          message: `Request ${req.method} requires an unlocked session`,
          data: { origin, method: req.method },
        });
      }
    }

    // Permission policy.
    const mode: PermissionCheck =
      definition.permissionCheck ?? (definition.scope ? PermissionChecks.Scope : PermissionChecks.None);

    switch (mode) {
      case PermissionChecks.None: {
        await next();
        return;
      }
      case PermissionChecks.Connected: {
        const chainRef = invocation?.chainRef ?? rpcContext?.chainRef ?? null;
        const namespaceForDebug =
          (invocation?.namespace ?? rpcContext?.namespace ?? (chainRef ? chainRef.split(":")[0] : null)) || null;

        const connected =
          origin !== UNKNOWN_ORIGIN &&
          chainRef !== null &&
          chainRef.length > 0 &&
          isConnected(origin, {
            // Avoid mismatch throws by letting the permission controller derive namespace from chainRef.
            namespace: null,
            chainRef: chainRef as ChainRef,
          });

        if (!connected) {
          throw arxError({
            reason: ArxReasons.PermissionNotConnected,
            message: `Origin "${origin}" is not connected`,
            data: {
              origin,
              method: req.method,
              chainRef,
              namespace: namespaceForDebug,
            },
          });
        }

        await next();
        return;
      }
      case PermissionChecks.Scope: {
        try {
          await assertPermission(origin, req.method, rpcContext);
        } catch (error) {
          if (isArxError(error)) throw error;
          throw arxError({
            reason: ArxReasons.PermissionDenied,
            message: (error as Error)?.message ?? `Origin lacks permission for ${req.method}`,
            data: { origin, method: req.method },
            cause: error,
          });
        }

        await next();
        return;
      }
    }

    return assertNever(mode);
  });
};
