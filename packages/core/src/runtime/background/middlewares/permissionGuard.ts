import { createAsyncMiddleware, type JsonRpcMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";
import type { MethodDefinition } from "../../../rpc/handlers/types.js";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import { UNKNOWN_ORIGIN } from "../constants.js";

type PermissionGuardDeps = {
  ensurePermission(origin: string, method: string, context?: RpcInvocationContext): Promise<void>;
  isInternalOrigin(origin: string): boolean;
  resolveMethodDefinition(method: string, context?: RpcInvocationContext): MethodDefinition | undefined;
  resolveProviderErrors(context?: RpcInvocationContext): {
    unauthorized(args: { message: string; data: { origin: string; method: string; reason: string } }): unknown;
  };
};

export const createPermissionGuardMiddleware = ({
  ensurePermission,
  isInternalOrigin,
  resolveMethodDefinition,
  resolveProviderErrors,
}: PermissionGuardDeps): JsonRpcMiddleware<JsonRpcParams, Json> => {
  return createAsyncMiddleware(async (req, _res, next) => {
    const origin = (req as { origin?: string }).origin ?? UNKNOWN_ORIGIN;
    if (isInternalOrigin(origin)) {
      await next();
      return;
    }

    const rpcContext = (req as { arx?: RpcInvocationContext }).arx;
    const definition = resolveMethodDefinition(req.method, rpcContext);
    const shouldEnforce = Boolean(definition?.scope) && !(definition?.isBootstrap ?? false);
    if (!shouldEnforce) {
      await next();
      return;
    }

    try {
      await ensurePermission(origin, req.method, rpcContext);
    } catch (error) {
      const providerErrors = resolveProviderErrors(rpcContext);
      throw providerErrors.unauthorized({
        message: (error as Error)?.message ?? `Origin lacks permission for ${req.method}`,
        data: { origin, method: req.method, reason: "permission_denied" },
      });
    }

    await next();
  });
};
