import type { NamespaceDefinition } from "./definition.js";
import { eip155Namespace } from "./eip155/namespace.js";

export const builtinNamespaces = [eip155Namespace] as const satisfies readonly NamespaceDefinition[];
