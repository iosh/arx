import type { RpcInvocationContext } from "@arx/core";
import type { TransportMeta } from "@arx/provider/types";
import type { PortContext } from "./types";

export type ExtendedRpcContext = RpcInvocationContext & {
  meta: TransportMeta | null;
};

export const buildRpcContext = (
  portContext: PortContext | undefined,
  chainRef: string | null,
): ExtendedRpcContext | undefined => {
  if (!portContext) return undefined;
  const namespace = portContext.namespace;
  const resolvedChainRef = chainRef ?? portContext.caip2 ?? null;
  const baseContext: RpcInvocationContext = { namespace, chainRef: resolvedChainRef };
  return {
    ...baseContext,
    meta: portContext.meta,
  };
};
