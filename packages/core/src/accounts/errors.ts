import { ArxBaseError } from "../errors.js";
import type { AccountId } from "./addressing/accountId.js";

export class AccountNotOwnedError extends ArxBaseError {
  static readonly code = "account.not_owned";

  constructor(input: { accountId: AccountId; chainRef: string; namespace: string }) {
    super("Requested account is not owned by this wallet.", {
      code: AccountNotOwnedError.code,
      details: {
        accountId: input.accountId,
        chainRef: input.chainRef,
        namespace: input.namespace,
      },
    });
  }
}

export class AccountAddressNamespaceNotSupportedError extends ArxBaseError {
  static readonly code = "account.address_namespace_not_supported";

  constructor(input: { namespace: string }) {
    super(`No account address handling is available for namespace "${input.namespace}".`, {
      code: AccountAddressNamespaceNotSupportedError.code,
      details: { namespace: input.namespace },
    });
  }
}

export class AccountNamespaceMismatchError extends ArxBaseError {
  static readonly code = "account.namespace_mismatch";

  constructor(input: { namespace: string; accountNamespace: string }) {
    super(`Account does not belong to namespace "${input.namespace}".`, {
      code: AccountNamespaceMismatchError.code,
      details: { namespace: input.namespace, accountNamespace: input.accountNamespace },
    });
  }
}

export class AccountNotFoundError extends ArxBaseError {
  static readonly code = "account.not_found";

  constructor(accountId: AccountId) {
    super("Account was not found.", {
      code: AccountNotFoundError.code,
      details: { accountId },
    });
  }
}

export class AccountOperationRejectedError extends ArxBaseError {
  static readonly code = "account.operation_rejected";

  constructor(reason: string) {
    super("Account operation was rejected.", {
      code: AccountOperationRejectedError.code,
      details: { reason },
    });
  }
}
