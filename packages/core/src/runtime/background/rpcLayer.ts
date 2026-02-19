import { createEip155RpcClientFactory } from "../../rpc/namespaceClients/eip155.js";
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
}: {
  controllers: ControllersBase;
  rpcClientOptions?: RpcLayerOptions;
}) => {
  const rpcClientRegistry = new RpcClientRegistry({
    ...(rpcClientOptions?.options ?? {}),
    network: {
      getActiveEndpoint: (chainRef) => controllers.network.getActiveEndpoint(chainRef),
      reportRpcOutcome: (chainRef, outcome) => controllers.network.reportRpcOutcome(chainRef, outcome),
      onRpcEndpointChanged: (handler) => controllers.network.onRpcEndpointChanged(handler),
      onChainMetadataChanged: (handler) => controllers.network.onChainMetadataChanged(handler),
    },
  });

  rpcClientRegistry.registerFactory("eip155", createEip155RpcClientFactory());

  for (const entry of rpcClientOptions?.factories ?? []) {
    rpcClientRegistry.registerFactory(entry.namespace, entry.factory);
  }

  return rpcClientRegistry;
};
