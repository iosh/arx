import { ArxBaseError } from "../errors.js";
import type { Namespace } from "../namespaces/types.js";

export class PermissionAccountAccessUnavailableError extends ArxBaseError {
  static readonly code = "permission.account_access_unavailable";

  constructor(namespace: Namespace) {
    super(`No selectable account is available for namespace "${namespace}".`, {
      code: PermissionAccountAccessUnavailableError.code,
      details: { namespace },
    });
  }
}
