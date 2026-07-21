import type { DappConnectionScope } from "./persistence.js";

export const dappConnectionScopeKey = (scope: DappConnectionScope): string =>
  JSON.stringify([scope.origin, scope.namespace]);
