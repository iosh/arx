import type { NamespaceAdapter } from "../handlers/namespaces/adapter.js";
import type { RpcClientFactory } from "../RpcClientRegistry.js";

export type RpcNamespaceModule = {
  namespace: string;
  adapter: NamespaceAdapter;
  clientFactory?: RpcClientFactory;
};
