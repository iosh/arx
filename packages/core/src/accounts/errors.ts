import { ArxBaseError } from "../errors.js";
import type { Namespace } from "../namespaces/types.js";
import type { AccountId } from "./accountId.js";

export class AccountAlreadyExistsError extends ArxBaseError {
  static readonly code = "account.already_exists";

  constructor(accountId: AccountId) {
    super(`Account "${accountId}" already exists.`, {
      code: AccountAlreadyExistsError.code,
      details: { accountId },
    });
  }
}

export class AccountNotFoundError extends ArxBaseError {
  static readonly code = "account.not_found";

  constructor(accountId: AccountId) {
    super(`Account "${accountId}" was not found.`, {
      code: AccountNotFoundError.code,
      details: { accountId },
    });
  }
}

export class AccountNamespaceUnsupportedError extends ArxBaseError {
  static readonly code = "account.namespace_unsupported";

  constructor(namespace: Namespace) {
    super(`Accounts are not supported for namespace "${namespace}".`, {
      code: AccountNamespaceUnsupportedError.code,
      details: { namespace },
    });
  }
}

export class AccountNamespaceMismatchError extends ArxBaseError {
  static readonly code = "account.namespace_mismatch";

  constructor(input: { accountId: AccountId; accountNamespace: Namespace; chainNamespace: Namespace }) {
    super(`Account "${input.accountId}" does not belong to namespace "${input.chainNamespace}".`, {
      code: AccountNamespaceMismatchError.code,
      details: input,
    });
  }
}

export class AccountHiddenSelectionError extends ArxBaseError {
  static readonly code = "account.hidden_not_selectable";

  constructor(accountId: AccountId) {
    super(`Hidden account "${accountId}" cannot be selected.`, {
      code: AccountHiddenSelectionError.code,
      details: { accountId },
    });
  }
}

export class PrivateKeyAccountHiddenUnsupportedError extends ArxBaseError {
  static readonly code = "account.private_key_hide_unsupported";

  constructor(accountId: AccountId) {
    super(`Private-key account "${accountId}" cannot be hidden.`, {
      code: PrivateKeyAccountHiddenUnsupportedError.code,
      details: { accountId },
    });
  }
}

export class LastVisibleAccountHiddenError extends ArxBaseError {
  static readonly code = "account.last_visible_hide_unsupported";

  constructor(input: { accountId: AccountId; namespace: Namespace }) {
    super(`The last visible account in namespace "${input.namespace}" cannot be hidden.`, {
      code: LastVisibleAccountHiddenError.code,
      details: input,
    });
  }
}

export class AccountRemovalSelectionUnavailableError extends ArxBaseError {
  static readonly code = "account.removal_selection_unavailable";

  constructor(namespace: Namespace) {
    super(`Removing accounts would leave namespace "${namespace}" without a visible selection.`, {
      code: AccountRemovalSelectionUnavailableError.code,
      details: { namespace },
    });
  }
}

export class AccountSelectionMissingError extends ArxBaseError {
  static readonly code = "account.selection_missing";

  constructor(namespace: Namespace) {
    super(`Namespace "${namespace}" has no selected account.`, {
      code: AccountSelectionMissingError.code,
      details: { namespace },
    });
  }
}

export class AccountSelectionUnexpectedError extends ArxBaseError {
  static readonly code = "account.selection_unexpected";

  constructor(input: { namespace: Namespace; accountId: AccountId }) {
    super(`Namespace "${input.namespace}" has a selection but no accounts.`, {
      code: AccountSelectionUnexpectedError.code,
      details: input,
    });
  }
}

export class AccountSelectionTargetMissingError extends ArxBaseError {
  static readonly code = "account.selection_target_missing";

  constructor(input: { namespace: Namespace; accountId: AccountId }) {
    super(`Selected account "${input.accountId}" does not exist.`, {
      code: AccountSelectionTargetMissingError.code,
      details: input,
    });
  }
}

export class AccountSelectionTargetHiddenError extends ArxBaseError {
  static readonly code = "account.selection_target_hidden";

  constructor(input: { namespace: Namespace; accountId: AccountId }) {
    super(`Selected account "${input.accountId}" is hidden.`, {
      code: AccountSelectionTargetHiddenError.code,
      details: input,
    });
  }
}

export class AccountSelectionNamespaceMismatchError extends ArxBaseError {
  static readonly code = "account.selection_namespace_mismatch";

  constructor(input: { namespace: Namespace; accountId: AccountId; accountNamespace: Namespace }) {
    super(`Selected account "${input.accountId}" does not belong to namespace "${input.namespace}".`, {
      code: AccountSelectionNamespaceMismatchError.code,
      details: input,
    });
  }
}
