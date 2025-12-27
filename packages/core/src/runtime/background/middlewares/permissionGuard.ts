import { ArxReasons, arxError, isArxError } from "@arx/errors";
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
};

export const createPermissionGuardMiddleware = ({
  assertPermission,
  isConnected,
  isInternalOrigin,
  resolveMethodDefinition,
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
        throw arxError({
          reason: ArxReasons.PermissionNotConnected,
          message: `Origin "${origin}" is not connected`,
          data: { origin, method: req.method, chainRef: chainRef ?? null, namespace: namespace ?? null },
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
      if (isArxError(error)) {
        throw error;
      }
      throw arxError({
        reason: ArxReasons.PermissionDenied,
        message: (error as Error)?.message ?? `Origin lacks permission for ${req.method}`,
        data: { origin, method: req.method },
        cause: error,
      });
    }

    await next();
  });
};
