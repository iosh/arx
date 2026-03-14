import { type NamespaceManifest, registerRpcClientFactoriesFromManifests } from "../../namespaces/index.js";
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
  namespaceManifests,
}: {
  controllers: ControllersBase;
  rpcClientOptions?: RpcLayerOptions;
  namespaceManifests: readonly NamespaceManifest[];
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

  registerRpcClientFactoriesFromManifests(rpcClientRegistry, namespaceManifests);

  for (const entry of rpcClientOptions?.factories ?? []) {
    rpcClientRegistry.registerFactory(entry.namespace, entry.factory);
  }

  return rpcClientRegistry;
};
