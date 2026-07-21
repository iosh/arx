import { ArxBaseError } from "../errors.js";
import type { PermissionScope } from "./persistence.js";

export class PermissionNetworkSelectionMissingError extends ArxBaseError {
  static readonly code = "permission.network_selection_missing";

  constructor(scope: PermissionScope) {
    super("Permission scope has no dapp network selection.", {
      code: PermissionNetworkSelectionMissingError.code,
      details: scope,
    });
  }
}

export class PermissionNotConnectedError extends ArxBaseError {
  static readonly code = "permission.not_connected";

  constructor(scope: PermissionScope) {
    super("Origin has no account permission for the namespace.", {
      code: PermissionNotConnectedError.code,
      details: scope,
    });
  }
}

export class PermissionAccountNotAuthorizedError extends ArxBaseError {
  static readonly code = "permission.account_not_authorized";

  constructor(scope: PermissionScope) {
    super("Requested account is not authorized for the permission scope.", {
      code: PermissionAccountNotAuthorizedError.code,
      details: scope,
    });
  }
}
