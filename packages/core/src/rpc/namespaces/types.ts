import type { RpcClientFactory } from "../ChainRpcClientPool.js";
import type { NamespaceAdapter } from "../handlers/namespaces/adapter.js";

export type RpcNamespaceModule = {
  namespace: string;
  adapter: NamespaceAdapter;
  clientFactory?: RpcClientFactory;
};
