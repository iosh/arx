import {
  ChainRpcClientPool,
  type ChainRpcClientPoolOptions,
  type RpcClientFactory,
} from "../../rpc/ChainRpcClientPool.js";
import type { BackgroundStateServices } from "./backgroundStateServices.js";

export type RpcLayerOptions = {
  options?: Partial<Omit<ChainRpcClientPoolOptions, "chainRpc">>;
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
  const chainRpcClientPool = new ChainRpcClientPool({
    ...(rpcClientOptions?.options ?? {}),
    chainRpc: {
      getEndpoints: (chainRef) => stateServices.chainRpc.getEndpoints(chainRef),
      onEndpointsChanged: (handler) => stateServices.chainRpc.onEndpointsChanged(handler),
    },
  });

  for (const entry of factories ?? []) {
    chainRpcClientPool.registerFactory(entry.namespace, entry.factory);
  }

  return chainRpcClientPool;
};
