import { ArxBaseError } from "../errors.js";
import type { Namespace } from "../namespaces/types.js";
import type { PermissionScope } from "./persistence.js";

export class PermissionAccountAccessUnavailableError extends ArxBaseError {
  static readonly code = "permission.account_access_unavailable";

  constructor(namespace: Namespace) {
    super(`No selectable account is available for namespace "${namespace}".`, {
      code: PermissionAccountAccessUnavailableError.code,
      details: { namespace },
    });
  }
}

export class PermissionNetworkSelectionMissingError extends ArxBaseError {
  static readonly code = "permission.network_selection_missing";

  constructor(scope: PermissionScope) {
    super("Permission scope has no dapp network selection.", {
      code: PermissionNetworkSelectionMissingError.code,
      details: scope,
    });
  }
}
