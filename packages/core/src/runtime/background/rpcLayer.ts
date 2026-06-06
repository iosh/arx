import {
  type RpcClientFactory,
  RpcClientRegistry,
  type RpcClientRegistryOptions,
} from "../../rpc/RpcClientRegistry.js";
import type { BackgroundStateServices } from "./backgroundStateServices.js";

export type RpcLayerOptions = {
  options?: Partial<Omit<RpcClientRegistryOptions, "network">>;
  factories?: Array<{ namespace: string; factory: RpcClientFactory }>;
};

export const initRpcLayer = ({
  stateServices,
  rpcClientOptions,
  factories,
}: {
  stateServices: BackgroundStateServices;
  rpcClientOptions?: Pick<RpcLayerOptions, "options">;
  factories?: ReadonlyArray<{ namespace: string; factory: RpcClientFactory }>;
}) => {
  const rpcClientRegistry = new RpcClientRegistry({
    ...(rpcClientOptions?.options ?? {}),
    network: {
      getActiveEndpoint: (chainRef) => stateServices.network.getActiveEndpoint(chainRef),
      reportRpcOutcome: (chainRef, outcome) => stateServices.network.reportRpcOutcome(chainRef, outcome),
      onRpcEndpointChanged: (handler) => stateServices.network.onRpcEndpointChanged(handler),
      onChainConfigChanged: (handler) => stateServices.network.onChainConfigChanged(handler),
    },
  });

  for (const entry of factories ?? []) {
    rpcClientRegistry.registerFactory(entry.namespace, entry.factory);
  }

  return rpcClientRegistry;
};
