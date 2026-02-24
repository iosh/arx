import { eip155Module } from "./eip155/module.js";
import type { RpcNamespaceModule } from "./types.js";

export const BUILTIN_RPC_NAMESPACE_MODULES: readonly RpcNamespaceModule[] = [eip155Module];
