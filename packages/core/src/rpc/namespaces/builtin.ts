import { BUILTIN_NAMESPACE_MANIFESTS } from "../../namespaces/builtin.js";
import type { RpcNamespaceModule } from "./types.js";

export const BUILTIN_RPC_NAMESPACE_MODULES: readonly RpcNamespaceModule[] = BUILTIN_NAMESPACE_MANIFESTS.map(
  (manifest) => manifest.core.rpc,
);
