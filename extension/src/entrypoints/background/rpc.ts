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
  const resolvedChainRef = chainRef ?? portContext.chainRef ?? null;
  const baseContext: RpcInvocationContext = {
    ...(portContext.namespace ? { namespace: portContext.namespace } : {}),
    ...(resolvedChainRef ? { chainRef: resolvedChainRef } : {}),
  };
  return {
    ...baseContext,
    meta: portContext.meta,
  };
};
