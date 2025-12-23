import { createAsyncMiddleware, type JsonRpcMiddleware } from "@metamask/json-rpc-engine";
import type { Json, JsonRpcParams } from "@metamask/utils";
import type { Caip2ChainId } from "../../../chains/ids.js";
import { type ChainNamespace, PermissionScopes } from "../../../controllers/index.js";
import type { MethodDefinition } from "../../../rpc/handlers/types.js";
import type { RpcInvocationContext } from "../../../rpc/index.js";
import { UNKNOWN_ORIGIN } from "../constants.js";

type PermissionGuardDeps = {
  assertPermission(origin: string, method: string, context?: RpcInvocationContext): Promise<void>;
  isInternalOrigin(origin: string): boolean;

  isConnected: (origin: string, options: { namespace?: ChainNamespace | null; chainRef: Caip2ChainId }) => boolean;
  resolveMethodDefinition(method: string, context?: RpcInvocationContext): MethodDefinition | undefined;
  resolveProviderErrors(context?: RpcInvocationContext): {
    unauthorized(args: { message: string; data: { origin: string; method: string; reason: string } }): unknown;
  };
};

export const createPermissionGuardMiddleware = ({
  assertPermission,
  isConnected,
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

    const isApprovalScopedSignOrTx =
      definition?.approvalRequired === true &&
      !(definition?.isBootstrap ?? false) &&
      (definition.scope === PermissionScopes.Sign || definition.scope === PermissionScopes.Transaction);

    if (isApprovalScopedSignOrTx) {
      const providerErrors = resolveProviderErrors(rpcContext);

      const chainRef = rpcContext?.chainRef;
      const namespace = rpcContext?.namespace;

      const connected =
        origin !== UNKNOWN_ORIGIN &&
        typeof chainRef === "string" &&
        chainRef.length > 0 &&
        isConnected(origin, {
          namespace: (namespace ?? null) as ChainNamespace | null,
          chainRef: chainRef as Caip2ChainId,
        });

      if (!connected) {
        throw providerErrors.unauthorized({
          message: `Origin "${origin}" is not connected`,
          data: { origin, method: req.method, reason: "not_connected" },
        });
      }

      await next();
      return;
    }

    const shouldEnforce = Boolean(definition?.scope) && !(definition?.isBootstrap ?? false);
    if (!shouldEnforce) {
      await next();
      return;
    }
    if (!assertPermission) {
      throw new Error("Permission guard misconfigured: missing assertPermission");
    }

    try {
      await assertPermission(origin, req.method, rpcContext);
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
