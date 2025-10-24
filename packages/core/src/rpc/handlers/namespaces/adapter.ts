import type { MethodDefinition, Namespace } from "../types.js";

export type NamespaceAdapter = {
  namespace: Namespace;
  methodPrefixes?: string[];
  definitions: Record<string, MethodDefinition>;
};
