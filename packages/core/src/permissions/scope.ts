import type { Namespace } from "../namespaces/types.js";

export type DappScope = Readonly<{
  origin: string;
  namespace: Namespace;
}>;

export const dappScopeKey = (scope: DappScope): string => JSON.stringify([scope.origin, scope.namespace]);
