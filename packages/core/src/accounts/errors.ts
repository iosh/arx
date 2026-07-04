import { ArxBaseError, type ErrorCause } from "../error.js";
import type { AccountId } from "../storage/records.js";

export class AccountNotOwnedError extends ArxBaseError {
  static readonly code = "account.not_owned";

  constructor(input: ErrorCause & { accountId: AccountId; chainRef: string; namespace: string }) {
    super("Requested account is not owned by this wallet.", {
      code: AccountNotOwnedError.code,
      details: {
        accountId: input.accountId,
        chainRef: input.chainRef,
        namespace: input.namespace,
      },
      cause: input.cause,
    });
  }
}

export class AccountAddressNamespaceNotSupportedError extends ArxBaseError {
  static readonly code = "account.address_namespace_not_supported";

  constructor(input: ErrorCause & { namespace: string }) {
    super(`No account address handling is available for namespace "${input.namespace}".`, {
      code: AccountAddressNamespaceNotSupportedError.code,
      details: { namespace: input.namespace },
      cause: input.cause,
    });
  }
}

export class AccountNamespaceMismatchError extends ArxBaseError {
  static readonly code = "account.namespace_mismatch";

  constructor(input: ErrorCause & { namespace: string; accountNamespace: string }) {
    super(`Account does not belong to namespace "${input.namespace}".`, {
      code: AccountNamespaceMismatchError.code,
      details: { namespace: input.namespace, accountNamespace: input.accountNamespace },
      cause: input.cause,
    });
  }
}
