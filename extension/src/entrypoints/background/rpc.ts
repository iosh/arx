import type { ProviderBridgeRpcContext, ProviderSessionContext } from "./types";

export type ProviderBridgeRequestContext = ProviderBridgeRpcContext;

export const buildProviderRpcContext = (portContext: ProviderSessionContext): ProviderBridgeRequestContext => {
  return {
    namespace: portContext.namespace,
  };
};
