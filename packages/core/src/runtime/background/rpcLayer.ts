import {
  type RpcClientFactory,
  RpcClientRegistry,
  type RpcClientRegistryOptions,
} from "../../rpc/RpcClientRegistry.js";
import type { ControllersBase } from "./controllers.js";

export type RpcLayerOptions = {
  options?: Partial<Omit<RpcClientRegistryOptions, "network">>;
  factories?: Array<{ namespace: string; factory: RpcClientFactory }>;
};

export const initRpcLayer = ({
  controllers,
  rpcClientOptions,
  factories,
}: {
  controllers: ControllersBase;
  rpcClientOptions?: Pick<RpcLayerOptions, "options">;
  factories?: ReadonlyArray<{ namespace: string; factory: RpcClientFactory }>;
}) => {
  const rpcClientRegistry = new RpcClientRegistry({
    ...(rpcClientOptions?.options ?? {}),
    network: {
      getActiveEndpoint: (chainRef) => controllers.network.getActiveEndpoint(chainRef),
      reportRpcOutcome: (chainRef, outcome) => controllers.network.reportRpcOutcome(chainRef, outcome),
      onRpcEndpointChanged: (handler) => controllers.network.onRpcEndpointChanged(handler),
      onChainConfigChanged: (handler) => controllers.network.onChainConfigChanged(handler),
    },
  });

  for (const entry of factories ?? []) {
    rpcClientRegistry.registerFactory(entry.namespace, entry.factory);
  }

  return rpcClientRegistry;
};
