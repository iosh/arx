import { ArxReasons, arxError, isArxError } from "@arx/errors";
import { createAsyncMiddleware, type JsonRpcMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";
import type { ChainRef } from "../../../chains/ids.js";
import type { ChainNamespace } from "../../../controllers/index.js";
import { type MethodDefinition, type PermissionCheck, PermissionChecks } from "../../../rpc/handlers/types.js";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import { UNKNOWN_ORIGIN } from "../constants.js";
import type { ArxMiddlewareRequest } from "./requestTypes.js";

type PermissionGuardDeps = {
  assertPermission(origin: string, method: string, context?: RpcInvocationContext): Promise<void>;
  isInternalOrigin(origin: string): boolean;

  isConnected: (origin: string, options: { namespace?: ChainNamespace | null; chainRef: ChainRef }) => boolean;
  findMethodDefinition(method: string, context?: RpcInvocationContext): MethodDefinition | undefined;
};

const assertNever = (value: never): never => {
  throw new Error(`Unexpected permissionCheck: ${String(value)}`);
};

export const createPermissionGuardMiddleware = ({
  assertPermission,
  isConnected,
  isInternalOrigin,
  findMethodDefinition,
}: PermissionGuardDeps): JsonRpcMiddleware<JsonRpcParams, Json> => {
  return createAsyncMiddleware(async (req, _res, next) => {
    const reqWithArx = req as typeof req & ArxMiddlewareRequest;

    const origin = reqWithArx.origin ?? UNKNOWN_ORIGIN;
    if (isInternalOrigin(origin)) {
      await next();
      return;
    }

    const rpcContext = reqWithArx.arx;
    const definition = findMethodDefinition(req.method, rpcContext);

    // No definition => no permission gating (e.g. passthrough methods).
    if (!definition) {
      await next();
      return;
    }

    const mode: PermissionCheck =
      definition.permissionCheck ?? (definition.scope ? PermissionChecks.Scope : PermissionChecks.None);

    switch (mode) {
      case PermissionChecks.None: {
        await next();
        return;
      }
      case PermissionChecks.Connected: {
        const invocation = reqWithArx.arxInvocation;
        const chainRef = invocation?.chainRef ?? rpcContext?.chainRef ?? null;
        // Only used for error payload/debugging. The permission controller derives the effective
        // namespace from chainRef; passing a namespace here can cause mismatch throws.
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
        if (!assertPermission) {
          throw new Error("Permission guard misconfigured: missing assertPermission");
        }

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

    // Exhaustive check (keeps compiler honest when PermissionCheck evolves).
    return assertNever(mode);
  });
};
